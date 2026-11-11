"""Typed LangChain tools generated from the Evergreen OpenAPI specs.

One tool per operation of the five REST services, named by its operationId.
Path and query parameters become top-level tool arguments and the request body
becomes a `body` argument. Authentication lives in the tool layer: a
client-credentials token from AMS is fetched once, cached until shortly before
it expires, and sent as a Bearer token. There is no generic HTTP tool, so the
agent can only call the operations the specs define.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

import httpx
import yaml
from langchain_core.tools import StructuredTool

SPECS_DIR = Path(__file__).resolve().parents[2] / "specs"
REST_SERVICES = ("ams", "rater", "crm", "ecm", "claims")
SERVICE_PORTS = {
    "ams": 3000,
    "rater": 3001,
    "crm": 3002,
    "ecm": 3003,
    "comm": 3004,
    "summit-fire": 3005,
    "coastal-star": 3006,
    "claims": 3007,
}
TOKEN_FORM = {
    "grant_type": "client_credentials",
    "client_id": "agent-full",
    "client_secret": "dev-secret",
}
HTTP_METHODS = ("get", "post", "put", "patch", "delete")
# Keywords every model provider accepts in tool schemas. Validation keywords
# (pattern, minimum, maxLength, ...) and examples are dropped so all models see
# the same schema.
_SCHEMA_KEYWORDS = ("type", "format", "description", "enum", "default")
_TOKEN_REFRESH_MARGIN_S = 60.0

logger = logging.getLogger(__name__)


def service_base_urls():
    """Base URL per service: http://localhost:300X, shifted by EVERGREEN_BASE_PORT and overridden by EVERGREEN_BASE_URLS."""
    base_port_raw = os.environ.get("EVERGREEN_BASE_PORT", "").strip()
    try:
        parsed_base = int(base_port_raw) if base_port_raw else 0
    except ValueError:
        parsed_base = 0
    offset = (parsed_base - 3000) if parsed_base > 0 else 0
    urls = {name: f"http://localhost:{port + offset}" for name, port in SERVICE_PORTS.items()}
    override = os.environ.get("EVERGREEN_BASE_URLS")
    if override:
        urls.update(json.loads(override))
    return {name: url.rstrip("/") for name, url in urls.items()}


@dataclass(frozen=True)
class Operation:
    service: str
    operation_id: str
    method: str
    path: str
    description: str
    path_params: tuple[str, ...]
    query_params: tuple[str, ...]
    body_media_type: str | None
    binary_fields: tuple[str, ...]
    args_schema: dict[str, Any]


@cache
def load_operations(specs_dir: Path = SPECS_DIR):
    """Parse every operation of the five REST service specs."""
    operations: list[Operation] = []
    for service in REST_SERVICES:
        spec = yaml.safe_load((specs_dir / f"{service}.yaml").read_text())
        base_path = urlparse(spec["servers"][0]["url"]).path.rstrip("/")
        for path, item in spec["paths"].items():
            for method in HTTP_METHODS:
                if method in item:
                    operations.append(
                        _parse_operation(
                            spec, service, method, base_path + path, item.get("parameters", []), item[method]
                        )
                    )
    return tuple(operations)


def _resolve(spec: dict[str, Any], node: dict[str, Any]):
    while "$ref" in node:
        target: Any = spec
        for part in node["$ref"].removeprefix("#/").split("/"):
            target = target[part]
        node = target
    return node


def _text(value: str | None):
    return " ".join((value or "").split())


def _convert_schema(spec: dict[str, Any], schema: dict[str, Any], seen: frozenset[str] = frozenset()):
    """OpenAPI 3.0 request schema to a provider-neutral JSON schema: refs inlined, allOf merged, readOnly dropped."""
    ref = schema.get("$ref")
    if ref:
        if ref in seen:
            return {"type": "object"}
        return _convert_schema(spec, _resolve(spec, schema), seen | {ref})

    if "allOf" in schema:
        merged: dict[str, Any] = {"type": "object", "properties": {}}
        required: list[str] = []
        for part in schema["allOf"]:
            converted = _convert_schema(spec, part, seen)
            merged["properties"].update(converted.get("properties", {}))
            required += converted.get("required", [])
        if required:
            merged["required"] = required
        if schema.get("description"):
            merged["description"] = _text(schema["description"])
        return merged

    out = {key: schema[key] for key in _SCHEMA_KEYWORDS if key in schema}
    if "description" in out:
        out["description"] = _text(out["description"])
    # The specs mark IDs as uuid, but the seed data uses IDs such as CLI-008; a
    # provider that enforces formats while decoding could not produce them.
    if out.get("format") == "uuid":
        del out["format"]
    variants = schema.get("oneOf") or schema.get("anyOf")
    if variants:
        out["anyOf"] = [_convert_schema(spec, v, seen) for v in variants]
    if "items" in schema:
        out["items"] = _convert_schema(spec, schema["items"], seen)
    if "properties" in schema:
        props = {
            name: _convert_schema(spec, prop, seen)
            for name, prop in schema["properties"].items()
            if not _resolve(spec, prop).get("readOnly")
        }
        out["properties"] = props
        required = [name for name in schema.get("required", []) if name in props]
        if required:
            out["required"] = required
    additional = schema.get("additionalProperties")
    if isinstance(additional, bool):
        out["additionalProperties"] = additional
    elif isinstance(additional, dict):
        out["additionalProperties"] = _convert_schema(spec, additional, seen)
    return out


def _parse_operation(
    spec: dict[str, Any],
    service: str,
    method: str,
    path: str,
    shared_params: list[dict[str, Any]],
    op: dict[str, Any],
):
    params: dict[tuple[str, str], dict[str, Any]] = {}
    for raw in [*shared_params, *op.get("parameters", [])]:
        try:
            param = _resolve(spec, raw)
        except KeyError:
            # specs/ams.yaml listEscalations points at parameters/limit and
            # parameters/cursor, which the spec never defines.
            logger.warning("%s: skipping parameter with dangling $ref %s", op["operationId"], raw.get("$ref"))
            continue
        params[(param["name"], param["in"])] = param

    properties: dict[str, Any] = {}
    required: list[str] = []
    path_params: list[str] = []
    query_params: list[str] = []
    for (name, location), param in params.items():
        if location not in ("path", "query"):
            raise ValueError(f"{op['operationId']}: unsupported parameter location {location!r} for {name!r}")
        schema = _convert_schema(spec, param.get("schema", {"type": "string"}))
        if param.get("description"):
            schema["description"] = _text(param["description"])
        properties[name] = schema
        if location == "path" or param.get("required"):
            required.append(name)
        (path_params if location == "path" else query_params).append(name)

    body_media_type = None
    binary_fields: list[str] = []
    if "requestBody" in op:
        request_body = _resolve(spec, op["requestBody"])
        body_media_type, media = next(iter(request_body["content"].items()))
        raw_schema = media.get("schema", {"type": "object"})
        body_schema = _convert_schema(spec, raw_schema)
        if body_media_type == "multipart/form-data":
            for name, prop in _resolve(spec, raw_schema).get("properties", {}).items():
                if _resolve(spec, prop).get("format") == "binary":
                    binary_fields.append(name)
                    body_schema["properties"][name] = {
                        "type": "string",
                        "description": f"{_text(prop.get('description')) or 'File.'} Give the file content as text.",
                    }
        body_schema.setdefault("description", _text(request_body.get("description")) or "Request body.")
        properties["body"] = body_schema
        if request_body.get("required"):
            required.append("body")

    summary = _text(op.get("summary")).rstrip(".")
    description_parts = [
        f"{method.upper()} {path} ({service}).",
        f"{summary}." if summary else "",
        _text(op.get("description")),
    ]
    return Operation(
        service=service,
        operation_id=op["operationId"],
        method=method.upper(),
        path=path,
        description=" ".join(part for part in description_parts if part),
        path_params=tuple(path_params),
        query_params=tuple(query_params),
        body_media_type=body_media_type,
        binary_fields=tuple(binary_fields),
        args_schema={"type": "object", "properties": properties, "required": required},
    )


class RestClient:
    """Sends typed operations to the REST services with a cached client-credentials Bearer token."""

    def __init__(self, http: httpx.AsyncClient, base_urls: dict[str, str] | None = None):
        self.http = http
        self.base_urls = base_urls or service_base_urls()
        self._token: str | None = None
        self._token_expires_at = 0.0

    async def bearer_token(self):
        if self._token is None or time.monotonic() >= self._token_expires_at:
            resp = await self.http.post(f"{self.base_urls['ams']}/oauth/token", data=TOKEN_FORM)
            resp.raise_for_status()
            payload = resp.json()
            self._token = str(payload["access_token"])
            self._token_expires_at = time.monotonic() + float(payload.get("expires_in", 3600)) - _TOKEN_REFRESH_MARGIN_S
        return self._token

    async def call(self, op: Operation, args: dict[str, Any]):
        allowed = op.args_schema["properties"]
        unknown = sorted(set(args) - set(allowed))
        if unknown:
            return f"Error: {op.operation_id} has no argument(s) {unknown}. Arguments: {sorted(allowed)}."
        missing = [name for name in op.path_params if args.get(name) in (None, "")]
        if missing:
            return f"Error: {op.operation_id} needs path argument(s) {missing}."

        path = op.path
        for name in op.path_params:
            path = path.replace("{" + name + "}", quote(str(args[name]), safe=""))
        query = {name: _query_value(args[name]) for name in op.query_params if args.get(name) is not None}
        request: dict[str, Any] = {"headers": {"Authorization": f"Bearer {await self.bearer_token()}"}}
        body = args.get("body")
        if body is not None:
            if op.body_media_type == "multipart/form-data":
                request.update(_multipart(body, op.binary_fields))
            else:
                request["json"] = body

        resp = await self.http.request(op.method, self.base_urls[op.service] + path, params=query, **request)
        return format_response(resp)


def _query_value(value: Any):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return [_query_value(v) for v in value]
    return value


def _multipart(body: dict[str, Any], binary_fields: tuple[str, ...]):
    files = {name: (f"{name}.txt", str(body[name]).encode(), "text/plain") for name in binary_fields if name in body}
    data = {
        name: [str(v) for v in value] if isinstance(value, list) else str(value)
        for name, value in body.items()
        if name not in binary_fields
    }
    return {"data": data, "files": files}


def format_response(resp: httpx.Response):
    """Status line plus body; binary bodies such as generated PDFs are summarized, not dumped."""
    content_type = resp.headers.get("content-type", "")
    if not resp.content or "json" in content_type or content_type.startswith("text/"):
        body = resp.text
    else:
        body = f"<{len(resp.content)} bytes of {content_type.split(';')[0]}>"
    return f"HTTP {resp.status_code}\n{body}"


def build_rest_tools(client: RestClient, operations: tuple[Operation, ...] | None = None):
    """One LangChain tool per operation, sharing the client's HTTP session and token."""
    return [_tool(client, op) for op in (operations if operations is not None else load_operations())]


def _tool(client: RestClient, op: Operation):
    async def call_operation(**kwargs: Any):
        return await client.call(op, kwargs)

    return StructuredTool.from_function(
        coroutine=call_operation,
        name=op.operation_id,
        description=op.description,
        args_schema=op.args_schema,
    )

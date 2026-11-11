"""Tool generation against the real specs: no network, no models."""

from __future__ import annotations

import asyncio
import json
from collections import Counter
from typing import Any
from urllib.parse import parse_qs

import httpx
import pytest
import yaml

from openapi_tools import (
    REST_SERVICES,
    SPECS_DIR,
    RestClient,
    build_rest_tools,
    load_operations,
    service_base_urls,
)

BASE_URLS = {
    "ams": "http://ams.test",
    "rater": "http://rater.test",
    "crm": "http://crm.test",
    "ecm": "http://ecm.test",
    "claims": "http://claims.test",
}


def spec_operation_ids(service: str):
    spec = yaml.safe_load((SPECS_DIR / f"{service}.yaml").read_text())
    return [
        op["operationId"]
        for item in spec["paths"].values()
        for method, op in item.items()
        if method in ("get", "post", "put", "patch", "delete")
    ]


class FakeServices:
    """httpx transport that records requests and answers like the services."""

    def __init__(self, expires_in: int = 3600):
        self.requests: list[httpx.Request] = []
        self.expires_in = expires_in
        self.tokens_issued = 0

    def handler(self, request: httpx.Request):
        self.requests.append(request)
        if request.url.path == "/oauth/token":
            self.tokens_issued += 1
            token = f"token-{self.tokens_issued}"
            return httpx.Response(200, json={"access_token": token, "token_type": "bearer", "expires_in": self.expires_in})
        if request.url.path.startswith("/v1/documents/acord/"):
            return httpx.Response(200, content=b"%PDF-1.7 fake", headers={"content-type": "application/pdf"})
        return httpx.Response(201 if request.method == "POST" else 200, json={"ok": True})

    def client(self, base_urls: dict[str, str] | None = None):
        http = httpx.AsyncClient(transport=httpx.MockTransport(self.handler))
        return RestClient(http, base_urls or BASE_URLS)

    def api_requests(self):
        return [r for r in self.requests if r.url.path != "/oauth/token"]


def tools_by_name(client: RestClient):
    return {tool.name: tool for tool in build_rest_tools(client)}


def call(tool: Any, args: dict[str, Any]):
    return asyncio.run(tool.ainvoke(args))


def test_one_tool_per_operation_named_by_operation_id():
    tools = build_rest_tools(FakeServices().client())
    expected = [op_id for service in REST_SERVICES for op_id in spec_operation_ids(service)]

    assert len(tools) == len(expected) == 56
    assert sorted(tool.name for tool in tools) == sorted(expected)
    assert len({tool.name for tool in tools}) == len(expected)
    assert Counter(op.service for op in load_operations()) == {
        "ams": 19,
        "rater": 6,
        "crm": 9,
        "ecm": 13,
        "claims": 9,
    }


def test_tools_only_reach_the_five_rest_services():
    # Names alone cannot show this: carrier-coastal.yaml also has a bindQuote.
    services = FakeServices()
    ops = load_operations()
    for tool, op in zip(build_rest_tools(services.client()), ops):
        call(tool, {name: "x" for name in op.path_params})

    assert len(services.api_requests()) == len(ops) == 56
    assert {r.url.host for r in services.api_requests()} == {
        "ams.test",
        "rater.test",
        "crm.test",
        "ecm.test",
        "claims.test",
    }
    assert {op.service for op in load_operations()} == set(REST_SERVICES)


def test_path_query_and_body_parameters_come_from_the_spec():
    ops = {op.operation_id: op for op in load_operations()}

    endorse = ops["createEndorsement"]
    assert (endorse.method, endorse.path) == ("POST", "/v1/policies/{id}/endorsements")
    assert endorse.path_params == ("id",)
    assert endorse.args_schema["required"] == ["id", "body"]
    body = endorse.args_schema["properties"]["body"]
    assert body["required"] == ["effective_date", "change_type", "changes"]
    assert "add_vehicle" in body["properties"]["change_type"]["enum"]

    list_clients = ops["listClients"]
    assert list_clients.query_params == ("status", "last_name", "household_id", "limit", "cursor")
    assert list_clients.args_schema["required"] == []
    assert list_clients.args_schema["properties"]["status"]["enum"] == ["active", "inactive", "prospect"]
    assert list_clients.args_schema["properties"]["limit"]["type"] == "integer"

    # Path parameter declared through components/parameters.
    audit = ops["auditClientDocuments"]
    assert audit.path_params == ("client_id",)
    assert audit.query_params == ("limit", "cursor", "status")

    upload = ops["uploadDocument"]
    assert upload.body_media_type == "multipart/form-data"
    assert upload.binary_fields == ("file",)
    assert upload.args_schema["properties"]["body"]["properties"]["file"]["type"] == "string"


def test_schemas_are_inlined_and_provider_neutral():
    banned = {"$ref", "allOf", "oneOf", "nullable", "example", "readOnly", "pattern", "maxLength", "minimum"}

    def walk(node: Any, where: str):
        if isinstance(node, dict):
            if isinstance(node.get("properties"), dict):
                for name, prop in node["properties"].items():
                    walk(prop, f"{where}.{name}")
                rest = {k: v for k, v in node.items() if k != "properties"}
            else:
                rest = node
            assert not banned & set(rest), (where, banned & set(rest))
            assert rest.get("format") not in ("uuid", "binary"), where
            for value in rest.values():
                walk(value, where)
        elif isinstance(node, list):
            for value in node:
                walk(value, where)

    for op in load_operations():
        walk(op.args_schema, op.operation_id)
        json.dumps(op.args_schema)


def test_auth_header_path_encoding_and_json_body():
    services = FakeServices()
    tools = tools_by_name(services.client())

    out = call(
        tools["createEndorsement"],
        {"id": "POL 1/2", "body": {"effective_date": "2026-12-01", "change_type": "add_vehicle", "changes": {}}},
    )
    call(tools["listClients"], {"status": "active"})

    token_requests = [r for r in services.requests if r.url.path == "/oauth/token"]
    assert len(token_requests) == 1, "token is cached across calls"
    assert str(token_requests[0].url) == "http://ams.test/oauth/token"
    assert parse_qs(token_requests[0].content.decode()) == {
        "grant_type": ["client_credentials"],
        "client_id": ["agent-full"],
        "client_secret": ["dev-secret"],
    }

    endorse, clients = services.api_requests()
    assert endorse.method == "POST"
    assert endorse.url.raw_path == b"/v1/policies/POL%201%2F2/endorsements"
    assert endorse.url.host == "ams.test"
    assert endorse.headers["authorization"] == "Bearer token-1"
    assert json.loads(endorse.content) == {"effective_date": "2026-12-01", "change_type": "add_vehicle", "changes": {}}
    assert clients.headers["authorization"] == "Bearer token-1"
    assert out == 'HTTP 201\n{"ok":true}'

    # These headers would hide the call from the service-side trace or skip strict modality.
    for request in services.api_requests():
        assert "x-evergreen-internal" not in request.headers
        assert "x-eval-scorer" not in request.headers


def test_token_is_refreshed_after_expiry():
    services = FakeServices(expires_in=0)
    tools = tools_by_name(services.client())
    call(tools["listClients"], {})
    call(tools["listClients"], {})
    first, second = services.api_requests()
    assert first.headers["authorization"] == "Bearer token-1"
    assert second.headers["authorization"] == "Bearer token-2"


def test_query_parameters_skip_none_and_encode_booleans():
    services = FakeServices()
    tools = tools_by_name(services.client())
    call(tools["listAdjusters"], {"specialty": None, "active": True})
    call(tools["listClients"], {"status": "active", "limit": 5})
    adjusters, clients = services.api_requests()
    assert adjusters.url.host == "claims.test"
    assert dict(adjusters.url.params) == {"active": "true"}
    assert dict(clients.url.params) == {"status": "active", "limit": "5"}


def test_unknown_or_missing_arguments_are_rejected_without_a_request():
    services = FakeServices()
    tools = tools_by_name(services.client())
    assert call(tools["listClients"], {"colour": "red"}).startswith("Error: listClients has no argument(s) ['colour']")
    assert call(tools["getPolicyById"], {}).startswith("Error: getPolicyById needs path argument(s) ['id']")
    assert services.requests == []


def test_multipart_upload_sends_the_file_part():
    services = FakeServices()
    tools = tools_by_name(services.client())
    call(
        tools["uploadDocument"],
        {"body": {"file": "signed app", "client_id": "CLI-001", "document_type": "signed_application", "tags": ["a", "b"]}},
    )
    (upload,) = services.api_requests()
    assert upload.url.host == "ecm.test"
    assert upload.headers["content-type"].startswith("multipart/form-data")
    content = upload.content.decode()
    assert 'name="file"; filename="file.txt"' in content
    assert "signed app" in content
    assert content.count('name="tags"') == 2


def test_binary_responses_are_summarized():
    services = FakeServices()
    tools = tools_by_name(services.client())
    out = call(tools["generateAcordForm"], {"form_type": "90", "policy_id": "POL-1"})
    assert out == "HTTP 200\n<13 bytes of application/pdf>"


def test_base_urls_default_to_localhost_and_follow_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("EVERGREEN_BASE_URLS", raising=False)
    monkeypatch.delenv("EVERGREEN_BASE_PORT", raising=False)
    assert service_base_urls()["ams"] == "http://localhost:3000"
    assert service_base_urls()["claims"] == "http://localhost:3007"

    monkeypatch.setenv("EVERGREEN_BASE_PORT", "3200")
    shifted = service_base_urls()
    assert shifted["ams"] == "http://localhost:3200"
    assert shifted["comm"] == "http://localhost:3204"
    assert shifted["claims"] == "http://localhost:3207"
    monkeypatch.delenv("EVERGREEN_BASE_PORT", raising=False)

    monkeypatch.setenv("EVERGREEN_BASE_URLS", json.dumps({"ams": "http://gym:9000/", "claims": "http://gym:9007"}))
    urls = service_base_urls()
    assert urls["ams"] == "http://gym:9000"
    assert urls["rater"] == "http://localhost:3001"

    services = FakeServices()
    tools = tools_by_name(services.client(urls))
    call(tools["listClaims"], {})
    token, claims = services.requests
    assert str(token.url) == "http://gym:9000/oauth/token"
    assert str(claims.url) == "http://gym:9007/v1/claims"

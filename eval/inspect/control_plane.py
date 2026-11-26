"""Shared fail-closed Python control-plane helpers for Evergreen adapters.

Uses only the Python standard library so Inspect AI, OpenEnv, and METR adapters
can share identical `/sim/*` requests without requiring optional third-party
packages (`httpx`, `inspect_ai`) inside minimal container runtimes.
"""

from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.request
from typing import Any, Callable

SERVICE_PORTS: dict[str, int] = {
    "ams": 3000,
    "rater": 3001,
    "crm": 3002,
    "ecm": 3003,
    "comm": 3004,
    "summit-fire": 3005,
    "coastal-star": 3006,
    "claims": 3007,
}

PORT_SERVICE_MAP: dict[int, str] = {port: svc for svc, port in SERVICE_PORTS.items()}

SyncHttpHandler = Callable[
    [str, str, dict[str, Any] | None, dict[str, str]],
    tuple[int, Any],
]


def seed_mode(seed: str) -> str:
    """Map task seed variant to the service `/sim/reset` seed mode."""
    return "clean" if seed == "clean" else "realistic"


def normalize_scenario_id(scenario_id: str | int | None) -> str | None:
    """Normalize numeric scenario IDs to zero-padded 2-digit strings (e.g. '07')."""
    if scenario_id is None:
        return None
    raw = str(scenario_id).strip()
    if not raw:
        return None
    return raw.zfill(2) if raw.isdigit() else raw


def build_reset_payload(seed: str, scenario_id: str | int | None = None) -> dict[str, Any]:
    """Build the canonical `POST /sim/reset` payload shared across all adapters."""
    payload: dict[str, Any] = {"seed_mode": seed_mode(seed)}
    norm_sc = normalize_scenario_id(scenario_id)
    if norm_sc is not None:
        payload["scenario_id"] = norm_sc
    return payload


def scorer_headers(
    secret: str | None = None,
    extra: dict[str, str] | None = None,
) -> dict[str, str]:
    """Build `/sim/*` authorization headers matching `eval/evaluators/output.ts:scorerHeaders`."""
    headers: dict[str, str] = {"X-Eval-Scorer": "true"}
    resolved_secret = secret if secret is not None else os.environ.get("EVERGREEN_SCORER_SECRET", "")
    if resolved_secret:
        headers["X-Evergreen-Scorer-Secret"] = resolved_secret
    if extra:
        headers.update(extra)
    return headers


def service_base_urls(
    host: str = "http://localhost",
    base_port: int | None = None,
    services: list[str] | tuple[str, ...] | None = None,
) -> dict[str, str]:
    """Resolve base URLs per service, honoring `EVERGREEN_BASE_PORT` and `EVERGREEN_BASE_URLS`."""
    clean_host = host.rstrip("/")
    if base_port is not None:
        offset = base_port - 3000
    else:
        raw_port = os.environ.get("EVERGREEN_BASE_PORT", "").strip()
        try:
            parsed = int(raw_port) if raw_port else 0
        except ValueError:
            parsed = 0
        offset = (parsed - 3000) if parsed > 0 else 0

    urls = {name: f"{clean_host}:{port + offset}" for name, port in SERVICE_PORTS.items()}
    override = os.environ.get("EVERGREEN_BASE_URLS")
    if override and base_port is None and clean_host == "http://localhost":
        parsed_override = json.loads(override)
        if not isinstance(parsed_override, dict):
            raise ValueError("EVERGREEN_BASE_URLS must be a JSON object mapping service names to URLs")
        urls.update({str(k): str(v) for k, v in parsed_override.items()})

    normalized = {name: url.rstrip("/") for name, url in urls.items()}
    if services is not None:
        return {name: normalized[name] for name in services}
    return normalized


def extract_snapshot_tables(payload: Any, service: str = "") -> dict[str, Any]:
    """Extract `{table: rows}` from a `/sim/snapshot` response, rejecting non-dict payloads."""
    if not isinstance(payload, dict):
        prefix = f"{service}: " if service else ""
        raise RuntimeError(f"{prefix}invalid /sim/snapshot payload type {type(payload).__name__}")
    tables = payload.get("tables")
    if isinstance(tables, dict):
        return tables
    return payload


def merge_otlp_traces(traces: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge per-service OTLP traces in `startTimeUnixNano` order (mirrors `eval/collect-trace.ts`)."""
    entries: list[tuple[int, dict[str, Any], dict[str, Any], dict[str, Any]]] = []
    for trace in traces:
        for rs in trace.get("resourceSpans", []):
            resource = rs.get("resource", {})
            for ss in rs.get("scopeSpans", []):
                scope = {k: v for k, v in ss.items() if k != "spans"}
                for span in ss.get("spans", []):
                    start_ns = int(span.get("startTimeUnixNano", "0") or "0")
                    entries.append((start_ns, resource, scope, span))

    entries.sort(key=lambda item: item[0])
    resource_spans: list[dict[str, Any]] = []
    prev_resource: dict[str, Any] | None = None
    prev_scope: dict[str, Any] | None = None
    for _, resource, scope, span in entries:
        if resource != prev_resource or scope != prev_scope or not resource_spans:
            resource_spans.append(
                {
                    "resource": resource,
                    "scopeSpans": [{**scope, "spans": []}],
                }
            )
            prev_resource = resource
            prev_scope = scope
        resource_spans[-1]["scopeSpans"][0]["spans"].append(span)
    return {"resourceSpans": resource_spans}


def _request_json_sync(
    method: str,
    url: str,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    *,
    service: str = "",
    timeout: float = 15.0,
    http_handler: SyncHttpHandler | None = None,
) -> tuple[int, Any]:
    req_headers = dict(headers or {})
    if body is not None:
        req_headers.setdefault("Content-Type", "application/json")
    prefix = f"{service}: " if service else ""

    if http_handler is not None:
        try:
            status, payload = http_handler(method, url, body, req_headers)
        except Exception as exc:
            raise RuntimeError(f"{prefix}{method} {url} failed: {exc}") from exc
        if status < 200 or status >= 300:
            raise RuntimeError(f"{prefix}{method} {url} failed with HTTP {status}: {payload}")
        return status, payload

    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = int(getattr(resp, "status", 200))
            if status < 200 or status >= 300:
                raise RuntimeError(f"{prefix}{method} {url} failed with HTTP {status}")
            raw_bytes = resp.read()
            raw = raw_bytes.decode("utf-8") if isinstance(raw_bytes, (bytes, bytearray)) else str(raw_bytes or "")
            return status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            detail = str(exc)
        raise RuntimeError(f"{prefix}{method} {url} failed with HTTP {exc.code}: {detail}") from exc
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"{prefix}{method} {url} failed: {exc}") from exc


def check_modality(
    urls: dict[str, str],
    modality_mode: str,
    *,
    secret: str | None = None,
    timeout: float = 5.0,
    http_handler: SyncHttpHandler | None = None,
) -> None:
    """Verify `GET /sim/status` returns 2xx and matches `modality_mode` on every service."""
    headers = scorer_headers(secret=secret)
    for name, base_url in urls.items():
        url = f"{base_url.rstrip('/')}/sim/status"
        _, payload = _request_json_sync(
            "GET", url, None, headers, service=name, timeout=timeout, http_handler=http_handler
        )
        actual = payload.get("modality_mode", "permissive") if isinstance(payload, dict) else None
        if actual != modality_mode:
            raise RuntimeError(
                f"{name} runs with MODALITY_MODE={actual!r}, expected {modality_mode!r}"
            )


def reset_services(
    urls: dict[str, str],
    seed: str,
    scenario_id: str | int | None = None,
    *,
    secret: str | None = None,
    timeout: float = 15.0,
    http_handler: SyncHttpHandler | None = None,
) -> dict[str, Any]:
    """Reset all services via `POST /sim/reset`; raises `RuntimeError` on any non-2xx or error."""
    payload = build_reset_payload(seed, scenario_id)
    headers = scorer_headers(secret=secret, extra={"Content-Type": "application/json"})
    statuses: dict[str, Any] = {}
    for name, base_url in urls.items():
        url = f"{base_url.rstrip('/')}/sim/reset"
        status_code, body = _request_json_sync(
            "POST", url, payload, headers, service=name, timeout=timeout, http_handler=http_handler
        )
        statuses[name] = {"status_code": status_code, "response": body}
    return statuses


def take_snapshot(
    urls: dict[str, str],
    *,
    secret: str | None = None,
    timeout: float = 15.0,
    http_handler: SyncHttpHandler | None = None,
) -> dict[str, Any]:
    """Fetch `GET /sim/snapshot` across all services; raises `RuntimeError` on any non-2xx or error."""
    headers = scorer_headers(secret=secret)
    snapshot: dict[str, Any] = {}
    for name, base_url in urls.items():
        url = f"{base_url.rstrip('/')}/sim/snapshot"
        _, payload = _request_json_sync(
            "GET", url, None, headers, service=name, timeout=timeout, http_handler=http_handler
        )
        snapshot[name] = extract_snapshot_tables(payload, service=name)
    return snapshot


def collect_trace(
    urls: dict[str, str],
    *,
    secret: str | None = None,
    timeout: float = 15.0,
    http_handler: SyncHttpHandler | None = None,
) -> dict[str, Any]:
    """Fetch `GET /sim/trace` from every service and merge; fails closed if any service fails."""
    headers = scorer_headers(secret=secret)
    traces: list[dict[str, Any]] = []
    failures: list[str] = []
    for name, base_url in urls.items():
        url = f"{base_url.rstrip('/')}/sim/trace"
        try:
            _, payload = _request_json_sync(
                "GET", url, None, headers, service=name, timeout=timeout, http_handler=http_handler
            )
            if not isinstance(payload, dict) or not isinstance(payload.get("resourceSpans"), list):
                failures.append(f"{name}: GET {url} returned invalid OTLP trace payload")
                continue
            traces.append(payload)
        except Exception as exc:
            failures.append(str(exc))

    if failures:
        raise RuntimeError("Could not collect the service-side trace:\n  " + "\n  ".join(failures))
    return merge_otlp_traces(traces)


export_otlp_trace = collect_trace


def set_chaos(
    urls: dict[str, str],
    *,
    enabled: bool,
    error_rate: float = 0.0,
    status_code: int = 503,
    latency_ms: int = 0,
    secret: str | None = None,
    timeout: float = 15.0,
    http_handler: SyncHttpHandler | None = None,
) -> dict[str, Any]:
    """Configure chaos fault injection via `POST /sim/chaos`; raises on any non-2xx or error."""
    body = {
        "enabled": enabled,
        "error_rate": error_rate,
        "status_code": status_code,
        "latency_ms": latency_ms,
    }
    headers = scorer_headers(secret=secret, extra={"Content-Type": "application/json"})
    results: dict[str, Any] = {}
    for name, base_url in urls.items():
        url = f"{base_url.rstrip('/')}/sim/chaos"
        _, payload = _request_json_sync(
            "POST", url, body, headers, service=name, timeout=timeout, http_handler=http_handler
        )
        results[name] = payload
    return results


def time_travel(
    urls: dict[str, str],
    *,
    days: float | None = None,
    target_date: str | None = None,
    secret: str | None = None,
    timeout: float = 15.0,
    http_handler: SyncHttpHandler | None = None,
) -> dict[str, Any]:
    """Advance simulated clock via `POST /sim/time-travel`; raises on any non-2xx or error."""
    if days is None and not target_date:
        raise ValueError("Provide either `days` or `target_date`.")
    body: dict[str, Any] = {}
    if days is not None:
        body["days"] = days
    if target_date is not None:
        body["target_date"] = target_date

    headers = scorer_headers(secret=secret, extra={"Content-Type": "application/json"})
    results: dict[str, Any] = {}
    for name, base_url in urls.items():
        url = f"{base_url.rstrip('/')}/sim/time-travel"
        _, payload = _request_json_sync(
            "POST", url, body, headers, service=name, timeout=timeout, http_handler=http_handler
        )
        results[name] = payload
    return results


def _check_async_status(service: str, method: str, url: str, resp: Any) -> None:
    status = int(getattr(resp, "status_code", 0))
    if status < 200 or status >= 300:
        detail = getattr(resp, "text", "")[:300]
        raise RuntimeError(f"{service}: {method} {url} failed with HTTP {status}: {detail}")


async def check_modality_async(
    http: Any,
    urls: dict[str, str],
    modality_mode: str,
    *,
    secret: str | None = None,
) -> None:
    """Async counterpart to `check_modality` for `httpx.AsyncClient` callers."""
    headers = scorer_headers(secret=secret)
    for name, base_url in urls.items():
        url = f"{base_url.rstrip('/')}/sim/status"
        try:
            resp = await http.get(url, headers=headers)
        except Exception as exc:
            raise RuntimeError(f"{name}: GET {url} failed: {exc}") from exc
        _check_async_status(name, "GET", url, resp)
        actual = resp.json().get("modality_mode", "permissive")
        if actual != modality_mode:
            raise RuntimeError(
                f"{name} runs with MODALITY_MODE={actual}, but the task has modality_mode={modality_mode}"
            )


async def reset_services_async(
    http: Any,
    urls: dict[str, str],
    seed: str,
    scenario_id: str | int | None = None,
    *,
    secret: str | None = None,
) -> None:
    """Async counterpart to `reset_services` for `httpx.AsyncClient` callers."""
    payload = build_reset_payload(seed, scenario_id)
    headers = scorer_headers(secret=secret, extra={"Content-Type": "application/json"})

    async def _reset(name: str, base_url: str) -> None:
        url = f"{base_url.rstrip('/')}/sim/reset"
        try:
            resp = await http.post(url, json=payload, headers=headers)
        except Exception as exc:
            raise RuntimeError(f"{name}: POST {url} failed: {exc}") from exc
        _check_async_status(name, "POST", url, resp)

    await asyncio.gather(*(_reset(name, base_url) for name, base_url in urls.items()))


async def take_snapshot_async(
    http: Any,
    urls: dict[str, str],
    *,
    secret: str | None = None,
) -> dict[str, Any]:
    """Async counterpart to `take_snapshot` for `httpx.AsyncClient` callers."""
    headers = scorer_headers(secret=secret)
    snapshot: dict[str, Any] = {}
    for name, base_url in urls.items():
        url = f"{base_url.rstrip('/')}/sim/snapshot"
        try:
            resp = await http.get(url, headers=headers)
        except Exception as exc:
            raise RuntimeError(f"{name}: GET {url} failed: {exc}") from exc
        _check_async_status(name, "GET", url, resp)
        snapshot[name] = extract_snapshot_tables(resp.json(), service=name)
    return snapshot


async def collect_trace_async(
    http: Any,
    urls: dict[str, str],
    *,
    secret: str | None = None,
) -> dict[str, Any]:
    """Async counterpart to `collect_trace` for `httpx.AsyncClient` callers."""
    headers = scorer_headers(secret=secret)

    async def _fetch(name: str, base_url: str) -> dict[str, Any]:
        url = f"{base_url.rstrip('/')}/sim/trace"
        try:
            resp = await http.get(url, headers=headers)
        except Exception as exc:
            raise RuntimeError(f"{name}: GET {url} failed: {exc}") from exc
        _check_async_status(name, "GET", url, resp)
        payload = resp.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("resourceSpans"), list):
            raise RuntimeError(f"{name}: GET {url} returned invalid OTLP trace payload")
        return payload

    results = await asyncio.gather(
        *(_fetch(name, base_url) for name, base_url in urls.items()),
        return_exceptions=True,
    )
    failures = [str(r) for r in results if isinstance(r, BaseException)]
    if failures:
        raise RuntimeError("Could not collect the service-side trace:\n  " + "\n  ".join(failures))
    return merge_otlp_traces([r for r in results if isinstance(r, dict)])


export_otlp_trace_async = collect_trace_async

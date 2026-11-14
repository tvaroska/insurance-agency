import { describe, it, expect } from "bun:test";
import { execFileSync } from "child_process";
import { resolve } from "path";
import {
  SERVICE_ENDPOINTS,
  resetAllServices,
  snapshotAllServices,
  timeTravelAllServices,
  configureChaosAllServices,
} from "../client";

function runPythonJson(code: string): any {
  const out = execFileSync("python3", ["-c", code], {
    cwd: resolve(import.meta.dir, ".."),
    encoding: "utf-8",
  });
  return JSON.parse(out.trim());
}

describe("OpenEnv & Prime Intellect verifiers Control Plane (S3-INTOP-3)", () => {
  it("exposes all 8 microservice endpoints in SERVICE_ENDPOINTS", () => {
    expect(SERVICE_ENDPOINTS).toHaveLength(8);
    expect(SERVICE_ENDPOINTS.map((e) => e.service)).toEqual([
      "ams",
      "rater",
      "crm",
      "ecm",
      "comm",
      "summit-fire",
      "coastal-star",
      "claims",
    ]);
  });

  it("orchestrates reset, snapshot, time-travel, and chaos across services via client.ts", async () => {
    const calls: { url: string; method: string; body?: any }[] = [];
    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: urlStr, method, body });

      if (urlStr.endsWith("/sim/reset")) {
        return new Response(
          JSON.stringify({
            status: "reset",
            service: "ams",
            seed_mode: body?.seed_mode ?? "realistic",
            simulated_time: "2026-03-01T00:00:00.000Z",
          }),
          { status: 200 },
        );
      }
      if (urlStr.endsWith("/sim/snapshot")) {
        return new Response(
          JSON.stringify({
            service: "ams",
            timestamp: "2026-03-01T00:00:00.000Z",
            simulated_time: "2026-03-01T00:00:00.000Z",
            tables: { clients: [{ id: "CLI-001" }] },
          }),
          { status: 200 },
        );
      }
      if (urlStr.endsWith("/sim/time-travel")) {
        return new Response(
          JSON.stringify({
            status: "ok",
            service: "ams",
            simulated_time: "2026-03-31T00:00:00.000Z",
            days_advanced: body?.days ?? 30,
            transitions: { expired_quotes: 2 },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "ams",
          chaos: {
            enabled: body?.enabled ?? true,
            error_rate: body?.error_rate ?? 0.25,
            status_code: body?.status_code ?? 503,
            latency_ms: body?.latency_ms ?? 100,
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const resetRes = await resetAllServices("clean", { fetchImpl: mockFetch });
    expect(Object.keys(resetRes)).toHaveLength(8);
    expect(resetRes.ams.seed_mode).toBe("clean");

    const snapRes = await snapshotAllServices({
      fetchImpl: mockFetch,
      services: ["ams", "claims"],
    });
    expect(Object.keys(snapRes)).toEqual(["ams", "claims"]);
    expect(snapRes.ams.tables.clients).toHaveLength(1);

    const ttRes = await timeTravelAllServices(
      { days: 30 },
      { fetchImpl: mockFetch, services: ["rater"] },
    );
    expect(ttRes.rater.days_advanced).toBe(30);

    const chaosRes = await configureChaosAllServices(
      { enabled: true, error_rate: 0.25, status_code: 503, latency_ms: 100 },
      { fetchImpl: mockFetch, services: ["summit-fire"] },
    );
    expect(chaosRes["summit-fire"].chaos.enabled).toBe(true);
    expect(chaosRes["summit-fire"].chaos.error_rate).toBe(0.25);
  });

  it("executes EvergreenGymEnv and EvergreenVerifiersEnv rollouts in Python", () => {
    const pyResult = runPythonJson(`
import json
import evergreen_env

def fake_http(method, url, body, headers):
    if url.endswith("/sim/reset"):
        return 200, {"status": "reset", "seed_mode": (body or {}).get("seed_mode", "realistic")}
    if url.endswith("/sim/time-travel"):
        return 200, {"status": "ok", "days_advanced": (body or {}).get("days", 0)}
    if url.endswith("/sim/chaos"):
        return 200, {"status": "ok", "chaos": body}
    return 200, {"data": [{"id": "CLI-001"}]}

def fake_scorer(task, spans):
    return {
        "overall": {"score": 0.92, "eoCompliant": True, "apiCalls": len(spans), "expectedRange": [5, 18]},
        "trace": {"score": 0.85, "checks": []},
        "output": {"score": 0.967, "checks": []},
        "eoTraps": [],
    }

vf_env = evergreen_env.load_environment(
    scenario="16",
    seed="realistic",
    difficulty="natural",
    max_turns=10,
)
vf_env._gym_factory = lambda tid: evergreen_env.EvergreenGymEnv(
    task_id=tid,
    max_steps=10,
    http_handler=fake_http,
    scorer_fn=fake_scorer,
)

rollout = vf_env.rollout(
    "16-realistic-natural",
    [
        {"service": "ams", "method": "GET", "path": "/v1/clients?last_name=Chen"},
        {"service": "comm", "method": "POST", "path": "/v1/messages/send", "body": {"to": "sarah.chen@email.com"}},
        {"done": True},
    ],
)

print(json.dumps({
    "dataset_len": len(vf_env.dataset),
    "steps": rollout["steps"],
    "rewards": rollout["rewards"],
    "api_calls": rollout["report"]["overall"]["apiCalls"],
}))
`);

    expect(pyResult.dataset_len).toBe(1);
    expect(pyResult.steps).toBe(3);
    expect(pyResult.api_calls).toBe(2);
    expect(pyResult.rewards.eo_compliance_reward).toBe(1);
    expect(pyResult.rewards.combined_reward).toBeCloseTo(0.92, 2);
  });

  it("collects service-side /sim/trace spans and honors EVERGREEN_BASE_PORT in EvergreenGymEnv", () => {
    const pyResult = runPythonJson(`
import json
import os
import evergreen_env

os.environ["EVERGREEN_BASE_PORT"] = "4100"
seen_urls = []

def fake_http(method, url, body, headers):
    seen_urls.append((method, url))
    if url.endswith("/sim/trace"):
        if ":4104/" in url:
            return 200, {
                "resourceSpans": [{
                    "resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "comm"}}]},
                    "scopeSpans": [{"spans": [{
                        "traceId": "t1",
                        "spanId": "s2",
                        "name": "POST /mcp",
                        "kind": 3,
                        "startTimeUnixNano": "200",
                        "endTimeUnixNano": "210",
                        "attributes": [
                            {"key": "http.request.method", "value": {"stringValue": "POST"}},
                            {"key": "url.full", "value": {"stringValue": "http://localhost:3004/mcp"}},
                            {"key": "server.port", "value": {"intValue": 3004}},
                            {"key": "http.response.status_code", "value": {"intValue": 200}},
                        ],
                    }]}],
                }]
            }
        if ":4105/" in url:
            return 200, {
                "resourceSpans": [{
                    "resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "summit-fire"}}]},
                    "scopeSpans": [{"spans": [{
                        "traceId": "t1",
                        "spanId": "s1",
                        "name": "POST /v1/summit/submissions",
                        "kind": 3,
                        "startTimeUnixNano": "100",
                        "endTimeUnixNano": "120",
                        "attributes": [
                            {"key": "http.request.method", "value": {"stringValue": "POST"}},
                            {"key": "url.full", "value": {"stringValue": "http://localhost:3005/v1/summit/submissions"}},
                            {"key": "server.port", "value": {"intValue": 3005}},
                            {"key": "http.response.status_code", "value": {"intValue": 201}},
                        ],
                    }]}],
                }]
            }
        return 200, {"resourceSpans": []}
    return 200, {"status": "reset"}

env = evergreen_env.EvergreenGymEnv(task_id="03-realistic-natural", http_handler=fake_http)
env.reset()
trace = env.export_otlp_trace()
os.environ.pop("EVERGREEN_BASE_PORT", None)
span_names = [s["name"] for rs in trace["resourceSpans"] for ss in rs["scopeSpans"] for s in ss["spans"]]
reset_ports = sorted(url.split(":")[2].split("/")[0] for m, url in seen_urls if url.endswith("/sim/reset"))
snap_ports = sorted(url.split(":")[2].split("/")[0] for m, url in seen_urls if url.endswith("/sim/snapshot"))
print(json.dumps({"span_names": span_names, "reset_ports": reset_ports, "snap_ports": snap_ports, "has_initial_snap": env._initial_snapshot is not None}))
`);

    expect(pyResult.reset_ports).toEqual(["4100", "4101", "4102", "4103", "4104", "4105", "4106", "4107"]);
    expect(pyResult.snap_ports).toEqual(["4100", "4101", "4102", "4103", "4104", "4105", "4106", "4107"]);
    expect(pyResult.has_initial_snap).toBe(true);
    expect(pyResult.span_names).toEqual(["POST /v1/summit/submissions", "POST /mcp"]);
  });
});

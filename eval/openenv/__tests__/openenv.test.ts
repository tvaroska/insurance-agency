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
});

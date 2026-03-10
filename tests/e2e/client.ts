/**
 * E2E HTTP client with auth, correlation IDs, and MCP support.
 */

import { generateDevToken } from "@evergreen/shared";
import { getServiceUrl, K8S_MODE, type ServiceName } from "./config";

const DEV_SECRET = "dev-secret";
let correlationCounter = 0;

function nextCorrelationId(): string {
  return `e2e-${Date.now()}-${++correlationCounter}`;
}

/**
 * Make an unauthenticated request to a service.
 */
export async function e2eRequest(
  service: ServiceName,
  path: string,
  init?: RequestInit & { headers?: Record<string, string> },
): Promise<Response> {
  const url = `${getServiceUrl(service)}${path}`;
  const headers: Record<string, string> = {
    "X-Correlation-ID": nextCorrelationId(),
    ...init?.headers,
  };
  return fetch(url, { ...init, headers });
}

/**
 * Make an authenticated request to a service.
 */
export async function e2eAuthRequest(
  service: ServiceName,
  path: string,
  scopes: string[],
  init?: RequestInit & { headers?: Record<string, string> },
): Promise<Response> {
  const token = K8S_MODE
    ? await fetchOAuthToken(scopes)
    : await generateDevToken({ secret: DEV_SECRET, scopes });

  return e2eRequest(service, path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
}

/**
 * Get a carrier portal dev token.
 */
export async function getCarrierToken(service: "carrier-summit" | "carrier-coastal"): Promise<string> {
  const res = await e2eRequest(service, "/auth/dev-token");
  if (!res.ok) throw new Error(`Failed to get carrier token: ${res.status}`);
  const body = await res.json();
  return body.token;
}

/**
 * Make an authenticated request to a carrier portal using its dev-token endpoint.
 */
export async function e2eCarrierRequest(
  service: "carrier-summit" | "carrier-coastal",
  path: string,
  init?: RequestInit & { headers?: Record<string, string> },
): Promise<Response> {
  const token = await getCarrierToken(service);
  return e2eRequest(service, path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
}

/**
 * Call an MCP tool on the Comm service using the MCP SDK client.
 * Creates a fresh client connection per call (stateless server).
 */
export async function mcpCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );

  const commUrl = getServiceUrl("comm");
  const transport = new StreamableHTTPClientTransport(new URL(`${commUrl}/mcp`));
  const client = new Client({ name: "e2e-test", version: "1.0.0" });

  await client.connect(transport);
  const result = await client.callTool({ name: toolName, arguments: args });
  await client.close();

  return result as { content: Array<{ type: string; text: string }>; isError?: boolean };
}

/**
 * Health-check a service. Returns true if healthy.
 */
export async function healthCheck(service: ServiceName): Promise<boolean> {
  try {
    const res = await e2eRequest(service, "/health");
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch an OAuth token from the K8s mock OAuth2 provider.
 */
async function fetchOAuthToken(scopes: string[]): Promise<string> {
  const res = await fetch(`${process.env.K8S_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      scope: scopes.join(" "),
    }),
  });
  if (!res.ok) throw new Error(`OAuth token request failed: ${res.status}`);
  const body = await res.json();
  return body.access_token;
}

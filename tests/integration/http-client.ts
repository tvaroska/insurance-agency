/**
 * HTTP client that matches Hono's app.request() interface for K8s integration testing.
 * When K8S_BASE_URL is set, tests make real HTTP requests instead of in-process calls.
 */

const BASE_URL = process.env.K8S_BASE_URL!;

export function createHttpClient(servicePath: string) {
  return {
    async request(
      path: string,
      init?: RequestInit & { headers?: Record<string, string> },
    ): Promise<Response> {
      const url = `${BASE_URL}/${servicePath}${path}`;
      return fetch(url, init);
    },
  };
}

/**
 * Fetch an OAuth token from the mock OAuth2 provider running in K8s.
 */
export async function fetchOAuthToken(scopes: string[]): Promise<string> {
  const res = await fetch(`${BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      scope: scopes.join(" "),
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth token request failed: ${res.status}`);
  }
  const body = await res.json();
  return body.access_token;
}

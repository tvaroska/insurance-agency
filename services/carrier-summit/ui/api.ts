let cachedToken: string | null = null;
let portalSession: { token: string; expiresAt: number } | null = null;
let portalSessionRequest: Promise<string> | null = null;

async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const res = await fetch("/auth/dev-token");
  const data = await res.json();
  cachedToken = data.token;
  return cachedToken;
}

async function requestPortalSession(): Promise<string> {
  let res = await fetch("/auth/portal-session");
  if (res.status === 403) {
    await fetch("/", { cache: "no-store" });
    res = await fetch("/auth/portal-session");
  }
  if (!res.ok) throw new Error(`Portal session error ${res.status}`);
  const data = await res.json();
  portalSession = {
    token: data.session_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return portalSession.token;
}

/** Returns the portal session token, requesting a new one when none is held or it expires within a minute. */
export function getPortalSession(): Promise<string> {
  if (portalSession && portalSession.expiresAt - Date.now() > 60_000) {
    return Promise.resolve(portalSession.token);
  }
  if (!portalSessionRequest) {
    portalSessionRequest = requestPortalSession().finally(() => {
      portalSessionRequest = null;
    });
  }
  return portalSessionRequest;
}

async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const send = async () =>
    fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Portal-Session": await getPortalSession(),
        ...options.headers,
      },
    });
  let res = await send();
  if (res.status === 403) {
    const body = await res.clone().json().catch(() => null);
    if (body?.error_code === "MODALITY_VIOLATION") {
      // Sessions live in service memory, so a restart drops ours. The guard
      // rejects before any handler runs, which makes the retry safe.
      portalSession = null;
      res = await send();
    }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.error?.message ?? body.message ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  submitProperty: (data: Record<string, unknown>) =>
    apiFetch("/v1/summit/submissions", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getQuote: (quoteId: string) =>
    apiFetch(`/v1/summit/quotes/${encodeURIComponent(quoteId)}`),

  getInspectionStatus: (quoteId: string) =>
    apiFetch(`/v1/summit/inspections/${encodeURIComponent(quoteId)}`),

  getConditions: (quoteId: string) =>
    apiFetch(`/v1/summit/inspections/${encodeURIComponent(quoteId)}/conditions`),

  submitDecision: (quoteId: string, decision: string, notes?: string) =>
    apiFetch(`/v1/summit/underwriting/${encodeURIComponent(quoteId)}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, ...(notes ? { notes } : {}) }),
    }),

  getPolicyDocuments: (policyId: string) =>
    apiFetch(`/v1/summit/policies/${encodeURIComponent(policyId)}/documents`),
};

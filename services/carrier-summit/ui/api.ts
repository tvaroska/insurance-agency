let cachedToken: string | null = null;

async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const res = await fetch("/auth/dev-token");
  const data = await res.json();
  cachedToken = data.token;
  return cachedToken;
}

async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
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

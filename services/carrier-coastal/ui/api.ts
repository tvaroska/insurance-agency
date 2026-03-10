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
  quickQuote: (data: {
    vin: string;
    driver_name: string;
    driver_dob: string;
    license_number: string;
    client_id: string;
  }) =>
    apiFetch("/v1/coastal/quotes/quick", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getQuote: (quoteId: string) =>
    apiFetch(`/v1/coastal/quotes/${encodeURIComponent(quoteId)}`),

  recalculatePremium: (quoteId: string, coverages: {
    bodily_injury: string;
    property_damage: number;
    collision_deductible: number;
    comprehensive_deductible: number;
    uninsured_motorist: string;
  }) =>
    apiFetch(`/v1/coastal/quotes/${encodeURIComponent(quoteId)}/recalculate`, {
      method: "POST",
      body: JSON.stringify(coverages),
    }),

  getRiskAssessment: (quoteId: string) =>
    apiFetch(`/v1/coastal/quotes/${encodeURIComponent(quoteId)}/risk-assessment`),

  bindQuote: (quoteId: string, effectiveDate: string, paymentPlan: string) =>
    apiFetch(`/v1/coastal/quotes/${encodeURIComponent(quoteId)}/bind`, {
      method: "POST",
      body: JSON.stringify({
        effective_date: effectiveDate,
        payment_plan: paymentPlan,
      }),
    }),

  getIdCard: (policyId: string) =>
    apiFetch(`/v1/coastal/policies/${encodeURIComponent(policyId)}/id-card`),
};

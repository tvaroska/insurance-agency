const AMS_BASE_URL = process.env.AMS_URL ?? "http://localhost:3000";

export interface AmsClient {
  id: string;
  first_name: string;
  last_name: string;
  dob: string | null;
  email: string;
  phone: string | null;
  address: { street: string; city: string; state: string; zip: string };
  driver_license_number: string | null;
  occupation: string | null;
  marital_status: string | null;
}

export interface AmsPolicy {
  policy_id: string;
  client_id: string;
  carrier_code: string;
  policy_type: string;
  effective_date: string;
  expiration_date: string;
  premium_current: number;
  premium_prior: number;
  status: string;
  multi_policy_discount: boolean;
  coverages: Array<{ type: string; limit: string | null; deductible: number | null }>;
}

export async function fetchClient(clientId: string, authToken: string): Promise<AmsClient> {
  const res = await fetch(`${AMS_BASE_URL}/v1/clients/${clientId}`, {
    headers: { Authorization: authToken },
  });
  if (!res.ok) {
    throw Object.assign(new Error(`AMS client lookup failed`), { status: res.status });
  }
  return res.json();
}

export async function fetchClientPolicies(
  clientId: string,
  authToken: string,
): Promise<AmsPolicy[]> {
  const res = await fetch(`${AMS_BASE_URL}/v1/clients/${clientId}/policies?limit=100`, {
    headers: { Authorization: authToken },
  });
  if (!res.ok) {
    throw Object.assign(new Error(`AMS policy lookup failed`), { status: res.status });
  }
  const body = await res.json();
  return body.data;
}

export async function fetchAllClients(authToken: string): Promise<AmsClient[]> {
  const res = await fetch(`${AMS_BASE_URL}/v1/clients?limit=100`, {
    headers: { Authorization: authToken },
  });
  if (!res.ok) {
    throw Object.assign(new Error(`AMS client list failed`), { status: res.status });
  }
  const body = await res.json();
  return body.data;
}

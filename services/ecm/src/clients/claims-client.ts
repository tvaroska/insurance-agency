const CLAIMS_BASE_URL = process.env.CLAIMS_URL ?? "http://localhost:3007";

export interface ClaimDetail {
  claim_id: string;
  policy_id: string;
  client_id: string;
  claim_type: string;
  status: string;
  loss_date: string;
  reported_date: string;
  loss_description: string;
  loss_location: string | null;
  reserve_amount: number | null;
  settlement_amount: number | null;
  adjuster: {
    adjuster_id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    specialty: string;
  } | null;
}

export async function fetchClaim(claimId: string, authToken: string): Promise<ClaimDetail> {
  const res = await fetch(`${CLAIMS_BASE_URL}/v1/claims/${claimId}`, {
    headers: { Authorization: authToken },
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Claims lookup failed`), { status: res.status });
  }
  return res.json();
}

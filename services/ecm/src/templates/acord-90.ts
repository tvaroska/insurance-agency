import {
  createAcordDocument,
  drawSectionHeader,
  drawFieldRow,
  drawCoverageTable,
  drawFooter,
  formatCurrency,
  type Coverage,
} from "./acord-common";

// ── Data interface ───────────────────────────────────────────────────

export interface Acord90Data {
  client: {
    first_name: string;
    last_name: string;
    dob: string | null;
    email: string;
    phone: string | null;
    address: { street: string; city: string; state: string; zip: string };
    driver_license_number: string | null;
    occupation: string | null;
    marital_status: string | null;
  };
  policy: {
    policy_id: string;
    carrier_code: string;
    policy_type: string;
    effective_date: string;
    expiration_date: string;
    premium_current: number;
    status: string;
    multi_policy_discount: boolean;
    coverages: Coverage[];
  };
}

// ── Generator ────────────────────────────────────────────────────────

export async function generateAcord90(data: Acord90Data): Promise<Uint8Array> {
  const { doc, page, fonts, y: startY } = await createAcordDocument(
    "90",
    "PERSONAL AUTOMOBILE APPLICATION",
  );

  let y = startY;
  const { client, policy } = data;

  // Section 1: Named Insured
  y = drawSectionHeader(page, y, "Named Insured", fonts);
  y = drawFieldRow(page, y, [
    { label: "FULL NAME", value: `${client.first_name} ${client.last_name}` },
    { label: "DATE OF BIRTH", value: client.dob },
    { label: "MARITAL STATUS", value: client.marital_status },
  ], fonts);
  y = drawFieldRow(page, y, [
    { label: "MAILING ADDRESS", value: `${client.address.street}, ${client.address.city}, ${client.address.state} ${client.address.zip}` },
    { label: "DRIVER LICENSE #", value: client.driver_license_number },
  ], fonts);
  y = drawFieldRow(page, y, [
    { label: "PHONE", value: client.phone },
    { label: "EMAIL", value: client.email },
    { label: "OCCUPATION", value: client.occupation },
  ], fonts);

  // Section 2: Policy Information
  y = drawSectionHeader(page, y, "Policy Information", fonts);
  y = drawFieldRow(page, y, [
    { label: "POLICY NUMBER", value: policy.policy_id },
    { label: "CARRIER", value: policy.carrier_code },
    { label: "STATUS", value: policy.status.toUpperCase() },
  ], fonts);
  y = drawFieldRow(page, y, [
    { label: "EFFECTIVE DATE", value: policy.effective_date },
    { label: "EXPIRATION DATE", value: policy.expiration_date },
    { label: "ANNUAL PREMIUM", value: formatCurrency(policy.premium_current) },
  ], fonts);
  y = drawFieldRow(page, y, [
    { label: "MULTI-POLICY DISCOUNT", value: policy.multi_policy_discount ? "Yes" : "No" },
  ], fonts);

  // Section 3: Coverage Schedule
  y = drawSectionHeader(page, y, "Automobile Coverage Schedule", fonts);
  y = drawCoverageTable(page, y, policy.coverages, fonts);

  // Footer
  drawFooter(page, "90", fonts);

  return doc.save();
}

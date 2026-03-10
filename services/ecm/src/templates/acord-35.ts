import {
  createAcordDocument,
  drawSectionHeader,
  drawFieldRow,
  drawWrappedText,
  drawFooter,
  formatCurrency,
  MARGIN,
  CONTENT_WIDTH,
  FONT_SIZE_BODY,
  FONT_SIZE_LABEL,
  type Coverage,
} from "./acord-common";

// ── Data interface ───────────────────────────────────────────────────

export interface Acord35Data {
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
  claim: {
    claim_id: string;
    claim_type: string;
    status: string;
    loss_date: string;
    reported_date: string;
    loss_description: string;
    loss_location: string | null;
    reserve_amount: number | null;
    settlement_amount: number | null;
    adjuster: {
      first_name: string;
      last_name: string;
      email: string;
      phone: string | null;
      specialty: string;
    } | null;
  };
}

// ── Generator ────────────────────────────────────────────────────────

export async function generateAcord35(data: Acord35Data): Promise<Uint8Array> {
  const { doc, page, fonts, y: startY } = await createAcordDocument(
    "35",
    "LOSS NOTICE",
  );

  let y = startY;
  const { client, policy, claim } = data;

  // Section 1: Insured Information
  y = drawSectionHeader(page, y, "Insured Information", fonts);
  y = drawFieldRow(page, y, [
    { label: "FULL NAME", value: `${client.first_name} ${client.last_name}` },
    { label: "PHONE", value: client.phone },
    { label: "EMAIL", value: client.email },
  ], fonts);
  y = drawFieldRow(page, y, [
    { label: "MAILING ADDRESS", value: `${client.address.street}, ${client.address.city}, ${client.address.state} ${client.address.zip}` },
  ], fonts);

  // Section 2: Policy Information
  y = drawSectionHeader(page, y, "Policy Information", fonts);
  y = drawFieldRow(page, y, [
    { label: "POLICY NUMBER", value: policy.policy_id },
    { label: "CARRIER", value: policy.carrier_code },
    { label: "POLICY TYPE", value: policy.policy_type.replace("_", " ").toUpperCase() },
  ], fonts);
  y = drawFieldRow(page, y, [
    { label: "EFFECTIVE DATE", value: policy.effective_date },
    { label: "EXPIRATION DATE", value: policy.expiration_date },
  ], fonts);

  // Section 3: Loss Information
  y = drawSectionHeader(page, y, "Loss Information", fonts);
  y = drawFieldRow(page, y, [
    { label: "DATE OF LOSS", value: claim.loss_date },
    { label: "DATE REPORTED", value: claim.reported_date },
    { label: "TYPE OF LOSS", value: claim.claim_type.replace(/_/g, " ").toUpperCase() },
  ], fonts);
  y = drawFieldRow(page, y, [
    { label: "LOCATION OF LOSS", value: claim.loss_location },
  ], fonts);

  // Loss description (wrapped text)
  page.drawText("DESCRIPTION OF LOSS", {
    x: MARGIN,
    y,
    size: FONT_SIZE_LABEL,
    font: fonts.regular,
    color: { type: "RGB", red: 0.4, green: 0.4, blue: 0.4 },
  });
  y -= 12;
  y = drawWrappedText(page, MARGIN, y, claim.loss_description, fonts.regular, FONT_SIZE_BODY, CONTENT_WIDTH);
  y -= 6;

  // Section 4: Claim Details
  y = drawSectionHeader(page, y, "Claim Details", fonts);
  y = drawFieldRow(page, y, [
    { label: "CLAIM NUMBER", value: claim.claim_id },
    { label: "CLAIM STATUS", value: claim.status.toUpperCase() },
  ], fonts);
  y = drawFieldRow(page, y, [
    { label: "RESERVE AMOUNT", value: claim.reserve_amount != null ? formatCurrency(claim.reserve_amount) : null },
    { label: "SETTLEMENT AMOUNT", value: claim.settlement_amount != null ? formatCurrency(claim.settlement_amount) : null },
  ], fonts);

  // Section 5: Adjuster Information (if assigned)
  if (claim.adjuster) {
    y = drawSectionHeader(page, y, "Adjuster Information", fonts);
    y = drawFieldRow(page, y, [
      { label: "ADJUSTER NAME", value: `${claim.adjuster.first_name} ${claim.adjuster.last_name}` },
      { label: "SPECIALTY", value: claim.adjuster.specialty.toUpperCase() },
    ], fonts);
    y = drawFieldRow(page, y, [
      { label: "EMAIL", value: claim.adjuster.email },
      { label: "PHONE", value: claim.adjuster.phone },
    ], fonts);
  }

  // Footer
  drawFooter(page, "35", fonts);

  return doc.save();
}

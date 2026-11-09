import {
  createAcordDocument,
  drawSectionHeader,
  drawFieldRow,
  drawCoverageTable,
  drawFooter,
  formatCurrency,
  type Coverage,
} from "./acord-common";

export interface Acord25Data {
  client: {
    id?: string;
    first_name: string;
    last_name: string;
    email: string;
    phone?: string | null;
    address?: { street?: string; city?: string; state?: string; zip?: string };
  };
  policy: {
    policy_id: string;
    carrier_code: string;
    policy_type: string;
    effective_date: string;
    expiration_date: string;
    premium_current: number;
    status: string;
    coverages?: Coverage[];
  };
  certificateHolder: {
    name: string;
    address?:
      | string
      | { street?: string; city?: string; state?: string; zip?: string };
  };
  description?: string;
}

function formatAddress(
  addr?: string | { street?: string; city?: string; state?: string; zip?: string },
): string {
  if (!addr) return "On File";
  if (typeof addr === "string") return addr;
  const parts = [addr.street, addr.city, addr.state, addr.zip].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "On File";
}

export async function generateAcord25(data: Acord25Data): Promise<Uint8Array> {
  const { doc, page, fonts, y: startY } = await createAcordDocument(
    "25",
    "CERTIFICATE OF LIABILITY INSURANCE",
  );

  let y = startY;
  const { client, policy, certificateHolder, description } = data;

  // Section 1: Producer & Insured
  y = drawSectionHeader(page, y, "Producer & Named Insured", fonts);
  y = drawFieldRow(
    page,
    y,
    [
      { label: "PRODUCER", value: "Evergreen Insurance Partners" },
      { label: "INSURED", value: `${client.first_name} ${client.last_name}` },
      { label: "INSURED EMAIL", value: client.email },
    ],
    fonts,
  );
  y = drawFieldRow(
    page,
    y,
    [
      { label: "INSURED ADDRESS", value: formatAddress(client.address) },
      { label: "INSURED PHONE", value: client.phone ?? null },
    ],
    fonts,
  );

  // Section 2: Coverages & Insurer Afforded
  y = drawSectionHeader(page, y, "Coverages & Policy Details", fonts);
  y = drawFieldRow(
    page,
    y,
    [
      { label: "POLICY NUMBER", value: policy.policy_id },
      { label: "INSURER / CARRIER", value: policy.carrier_code },
      { label: "LINE OF BUSINESS", value: policy.policy_type.toUpperCase() },
    ],
    fonts,
  );
  y = drawFieldRow(
    page,
    y,
    [
      { label: "POLICY EFF DATE", value: policy.effective_date },
      { label: "POLICY EXP DATE", value: policy.expiration_date },
      { label: "ANNUAL PREMIUM", value: formatCurrency(policy.premium_current) },
    ],
    fonts,
  );

  y = drawCoverageTable(page, y, policy.coverages ?? [], fonts);

  // Section 3: Description of Operations & Certificate Holder
  y = drawSectionHeader(
    page,
    y,
    "Certificate Holder & Description of Operations",
    fonts,
  );
  y = drawFieldRow(
    page,
    y,
    [
      { label: "CERTIFICATE HOLDER", value: certificateHolder.name },
      {
        label: "HOLDER ADDRESS",
        value: formatAddress(certificateHolder.address),
      },
    ],
    fonts,
  );
  y = drawFieldRow(
    page,
    y,
    [
      {
        label: "DESCRIPTION OF OPERATIONS / LOCATIONS",
        value:
          description ??
          `Evidence of active ${policy.policy_type} insurance coverage.`,
      },
    ],
    fonts,
  );

  drawFooter(page, "25", fonts);

  return doc.save();
}

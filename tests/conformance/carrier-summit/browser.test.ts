import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { openPortalPage } from "../harness";
import { COOKIE_NAME, documentRow, policyRow, quoteRow, start, type Ctx } from "./support";

let strict: Ctx;

const SEED = {
  tables: {
    quotes: [quoteRow({ quote_id: "QT-PENDING" })],
    policies: [policyRow({ policy_id: "POL-DOCS" })],
    policy_documents: [documentRow("SDOC-901", "POL-DOCS")],
  },
};

beforeAll(async () => {
  strict = await start({ MODALITY_MODE: "strict" });
}, 60_000);

beforeEach(async () => {
  await strict.svc.seed(SEED);
});

describe("Summit Fire headless portal DOM smoke (strict mode)", () => {
  test("Property Submission submits through the page", async () => {
    const page = await openPortalPage(strict.svc);
    try {
      expect(page.cookies.has(COOKIE_NAME)).toBe(true);
      await page.waitFor(() => page.text().includes("Property Submission"));

      // Step 1: Address & Client (Next stays disabled until required fields are entered).
      expect(page.buttonByText("Next").disabled).toBe(true);
      await page.type(page.inputByLabel("Client ID"), "CLI-001");
      await page.select(page.selectByLabel("Policy Type"), "homeowners");
      await page.type(page.inputByLabel("Street Address"), "1 Aspen St");
      await page.type(page.inputByLabel("City"), "Denver");
      await page.type(page.inputByLabel("State"), "CO");
      await page.type(page.inputByLabel("ZIP Code"), "80202");
      expect(page.buttonByText("Next").disabled).toBe(false);
      await page.click(page.buttonByText("Next"));

      // Step 2: Property Details.
      await page.waitFor(() => page.text().includes("Year Built"));
      expect(page.buttonByText("Next").disabled).toBe(true);
      await page.type(page.inputByLabel("Year Built"), "1996");
      await page.type(page.inputByLabel("Square Footage"), "2400");
      await page.select(page.selectByLabel("Construction Type"), "frame");
      await page.select(page.selectByLabel("Roof Type"), "metal");
      expect(page.buttonByText("Next").disabled).toBe(false);
      await page.click(page.buttonByText("Next"));

      // Step 3: Photo Checklist.
      await page.waitFor(() => page.text().includes("Front Exterior"));
      const firstPhotoCheckbox = page.root.querySelector('input[type="checkbox"]');
      expect(firstPhotoCheckbox).not.toBeNull();
      await page.click(firstPhotoCheckbox!);
      await page.click(page.buttonByText("Next"));

      // Step 4: Coverage Selection & Submit.
      await page.waitFor(() => page.text().includes("Dwelling Limit ($)"));
      expect(page.buttonByText("Submit Property").disabled).toBe(true);
      await page.type(page.inputByLabel("Dwelling Limit ($)"), "350000");
      await page.select(page.selectByLabel("Deductible ($)"), "1000");
      expect(page.buttonByText("Submit Property").disabled).toBe(false);

      const { diff } = await strict.svc.changes(async () => {
        await page.click(page.buttonByText("Submit Property"));
        await page.waitFor(() => page.text().includes("Property submission created successfully"));
      });

      // Verify backend SQLite persistence (new quote + 3 scheduled underwriting conditions).
      expect(diff.quotes.added).toHaveLength(1);
      const saved = diff.quotes.added[0];
      expect(saved).toMatchObject({
        client_id: "CLI-001",
        policy_type: "homeowners",
        status: "submitted",
        inspection_status: "scheduled",
      });
      expect(diff.underwriting_conditions.added).toHaveLength(3);

      // Verify rendered DOM banner shows the created quote ID.
      const rendered = page.text();
      expect(rendered).toContain(`Property submission created successfully (${saved.quote_id}).`);

      // Verify strict-mode handshake and X-Portal-Session header on the wire.
      const submitCall = page.requests.find((r) => r.method === "POST" && r.path === "/v1/summit/submissions");
      expect(submitCall).toBeDefined();
      expect(submitCall!.status).toBe(201);
      expect(submitCall!.headers["x-portal-session"]).toMatch(/^portal_sess_carrier-summit_/);
      expect(submitCall!.headers.authorization).toMatch(/^Bearer /);
      expect(submitCall!.requestBody).toMatchObject({
        client_id: "CLI-001",
        policy_type: "homeowners",
        photo_checklist: ["front_exterior"],
      });
    } finally {
      page.close();
    }
  });
});

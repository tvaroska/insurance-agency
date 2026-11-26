import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { openPortalPage } from "../harness";
import { COOKIE_NAME, policyRow, quoteRow, start, type Ctx } from "./support";

let strict: Ctx;

const SEED = {
  tables: {
    quotes: [quoteRow({ quote_id: "QT-ASSESSED" })],
    policies: [policyRow({ policy_id: "POL-OLD" })],
  },
};

beforeAll(async () => {
  strict = await start({ MODALITY_MODE: "strict" });
}, 60_000);

beforeEach(async () => {
  await strict.svc.seed(SEED);
});

describe("Coastal Star headless portal DOM smoke (strict mode)", () => {
  test("Quick Quote submits through the page", async () => {
    const page = await openPortalPage(strict.svc);
    try {
      expect(page.cookies.has(COOKIE_NAME)).toBe(true);
      await page.waitFor(() => page.text().includes("Quick Quote"));

      // Submit button starts disabled before required fields are filled.
      expect(page.buttonByText("Get Quote").disabled).toBe(true);

      // Enter VIN and exercise the in-page Decode action.
      await page.type(page.inputByLabel("VIN"), "1HGCM82633A004352");
      expect(page.buttonByText("Decode").disabled).toBe(false);
      await page.click(page.buttonByText("Decode"));
      await page.waitFor(() => page.text().includes("Decoded"));
      expect(page.text()).toContain("Honda");

      // Fill driver fields and submit through the real form button.
      await page.type(page.inputByLabel("Driver Name"), "Maria Rodriguez");
      await page.type(page.inputByLabel("Date of Birth"), "1985-05-05");
      await page.type(page.inputByLabel("License Number"), "TX-1234567");
      await page.type(page.inputByLabel("Client ID"), "CLI-003");
      expect(page.buttonByText("Get Quote").disabled).toBe(false);

      const { diff } = await strict.svc.changes(async () => {
        await page.click(page.buttonByText("Get Quote"));
        await page.waitFor(() => page.text().includes("Quote Result"));
      });

      // Verify rendered DOM reflects the server response.
      const rendered = page.text();
      expect(rendered).toContain("Quote Result");
      expect(rendered).toContain("$1,200.00");
      expect(rendered).toContain("$624.00");
      expect(rendered).toContain("$100.00");
      expect(rendered).toContain("CLI-003");

      // Verify backend SQLite persistence matches what the page rendered.
      expect(diff.quotes.added).toHaveLength(1);
      const saved = diff.quotes.added[0];
      expect(saved).toMatchObject({
        client_id: "CLI-003",
        driver_name: "Maria Rodriguez",
        driver_dob: "1985-05-05",
        driver_license: "TX-1234567",
        vin: "1HGCM82633A004352",
        status: "assessed",
      });
      expect(rendered).toContain(String(saved.quote_id));

      // Verify strict-mode browser handshake and X-Portal-Session header on the wire.
      const quickCall = page.requests.find((r) => r.method === "POST" && r.path === "/v1/coastal/quotes/quick");
      expect(quickCall).toBeDefined();
      expect(quickCall!.status).toBe(201);
      expect(quickCall!.headers["x-portal-session"]).toMatch(/^portal_sess_carrier-coastal_/);
      expect(quickCall!.headers.authorization).toMatch(/^Bearer /);
    } finally {
      page.close();
    }
  });
});

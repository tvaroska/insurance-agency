# Evergreen Insurance Partners — Design System Contract (`.stitch/DESIGN.md`)

**Tier:** Tier-2 Reusable Showcase Platform (Google Cloud / Material 3 GM3 Light)  
**Target Surface:** Evergreen Executive Operations & Governance Workbench (`http://localhost:3000/`) & Executive HTML Scorecard (`docs/executive-scorecard.html`)  
**Audience:** Insurance Technology Executives, Agency Principals, COOs, and E&O / Compliance Officers

---

## 1. Visual Philosophy & Tone

Evergreen's Executive Workbench is a calm, high-density enterprise operations console modeled after Google Cloud Console and Material 3 (GM3 Light). It prioritizes:
- **Deterministic Proof over Chat Theatrics:** Every AI action is paired with its 1st-line E&O Compliance Firewall gate, 2nd-line Principal Approval status, and 3rd-line 35-Table SQLite State-Diff Receipt.
- **High-Contrast Daylight Legibility:** Crisp white surface containers (`#ffffff`) over a cool slate canvas (`#f8fafc`) with 1px structural hairlines (`#e2e8f0`) and zero dark-mode/neon/glassmorphism gimmicks.
- **Financial & Actuarial Precision:** All currency, policy limits, token counts, and `pass^5` metrics use `font-variant-numeric: tabular-nums` and `JetBrains Mono` for vertical alignment.

---

## 2. Semantic CSS Token Contract

All workbench and scorecard surfaces bind strictly to semantic CSS variables so any carrier or agency brand can be swapped in a single stylesheet block:

```css
:root {
  /* Surfaces & Canvas (GM3 Light) */
  --surface: #f8fafc;
  --surface-container: #ffffff;
  --surface-container-low: #f1f5f9;
  --surface-container-high: #e2e8f0;
  --outline: #cbd5e1;
  --outline-variant: #e2e8f0;

  /* Typography & Ink */
  --on-surface: #0f172a;
  --on-surface-variant: #475569;
  --on-surface-muted: #64748b;

  /* Brand & Primary Actions */
  --primary: #1a73e8;
  --primary-hover: #1557b0;
  --primary-container: #e8f0fe;
  --on-primary: #ffffff;
  --on-primary-container: #174ea6;

  /* Evergreen Insurance Accent */
  --evergreen-accent: #0d652d;
  --evergreen-container: #e6f4ea;

  /* Semantic Governance Status Chips */
  --status-pass-bg: #e6f4ea;
  --status-pass-fg: #137333;
  --status-pass-border: #ceead6;

  --status-warn-bg: #fef7e0;
  --status-warn-fg: #b06000;
  --status-warn-border: #fde293;

  --status-block-bg: #fce8e6;
  --status-block-fg: #c5221f;
  --status-block-border: #fad2cf;

  --status-info-bg: #e8f0fe;
  --status-info-fg: #1967d2;
  --status-info-border: #d2e3fc;

  /* Typography Stacks */
  --font-sans: "Google Sans", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Elevation & Radii */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --shadow-card: 0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04);
}
```

---

## 3. Core Component Specifications

1. **Top App Bar & KPI Ribbon:**
   - Displays agency profile (**Evergreen Insurance Partners**, 11 staff, `$20M → $38.5M` written premium capacity, `$200K → $385K` revenue/employee), active defense lines (`1st Line: E&O Firewall ACTIVE`, `2nd Line: Principal Queue`, `3rd Line: 35-Table State-Diff`), and 4 primary navigation tabs.
2. **4 Executive Workbench Tabs:**
   - **Tab 1 — Agency Command & 5 Hero Journeys:** Interactive execution of the 5 Hero Journeys (15-Anomaly Book-of-Business Audit, 60-Second ACORD 25 COI Issuance, Multi-Carrier Commercial Submission across REST + Web Portals, Severe Claims FNOL & Fraud Triage, and Live E&O Trap Interception) plus the 11-Person Agency ROI Calculator.
   - **Tab 2 — Principal E&O & Escalation Queue (2nd Line of Defense):** Live inspection of HTTP `422 EO_COMPLIANCE_VIOLATION` statutory firewall blocks (`CA`, `TX`, `FL`, `NY`, `IL`, `PA`, `OH`, `GA`, `NC`, `MI`) and one-click Principal Approve / Deny actions on `pending` escalations in AMS (`escalations` + `escalation_events` tables).
   - **Tab 3 — 3rd-Line State-Diff & Multi-Modal Trace Inspector:** Side-by-side comparison of **What the Agent Claimed** vs. **35-Table SQLite Database State Diff** (`insertedCount`, `updatedCount`, `collateralFree`, `unauthorizedMutations`) and modality split (`REST`, `MCP`, `Browser Portal`).
   - **Tab 4 — 3-Stage Agent-to-Code Economics:** Live comparison of **Stage 1 (General Agent)** vs. **Stage 2 (Domain Skill)** vs. **Stage 3 (`$0`-Token Compiled Deterministic Code)** with `FallbackToSkill` recovery on mid-conversation client pivots (`Scenarios 17–20`).
3. **Favicon & Brand Hygiene:**
   - Every HTML document includes an inline SVG shield `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,...">` to guarantee zero `404 /favicon.ico` console errors.
   - All carrier brands across portals and REST APIs use fictional showcase names (`Summit Fire & Casualty`, `Coastal Star Auto`, `Hartland Commercial`, `Erie Basin Mutual`, `National Shield`, `SafeHarbor`, `Liberty Crest`).

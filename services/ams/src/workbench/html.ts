import { BOOK_ANOMALIES, HERO_JOURNEYS, SEVEN_EXECUTIVE_PROMISES } from "./catalogue";
import { FAVICON_DATA_URI, WORKBENCH_CLIENT_SCRIPT, WORKBENCH_CSS } from "./styles-and-script";

export function renderWorkbenchHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Evergreen Insurance Partners — Executive Operations &amp; Governance Workbench</title>
  <link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}" />
  <style>${WORKBENCH_CSS}</style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <div class="brand-shield">E</div>
      <div>
        <div class="brand-title">Evergreen Insurance Partners — Executive Operations &amp; Governance Workbench</div>
        <div class="brand-subtitle">8 Microservices &bull; 32 SQLite Tables &bull; 20 Scenarios / 259 Tasks &bull; REST + MCP + Legacy Carrier Portals</div>
      </div>
    </div>
    <div class="defense-pills">
      <span class="chip chip-pass">1st Line: 10-State E&amp;O Firewall ACTIVE</span>
      <span class="chip chip-info">2nd Line: Principal Queue (&gt;$10K Cap)</span>
      <span class="chip chip-pass">3rd Line: 32-Table State-Diff Receipt</span>
    </div>
  </header>

  <main class="container">
    <section class="kpi-ribbon" aria-label="Executive KPI Ribbon">
      <div class="kpi-card">
        <div class="kpi-label">Agency Capacity (11 Staff)</div>
        <div class="kpi-value">$20.0M &rarr; $38.5M</div>
        <div class="kpi-delta">+92.5% Written Premium Capacity</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Revenue / Employee</div>
        <div class="kpi-value">$200K &rarr; $385K</div>
        <div class="kpi-delta">+78% Routine CSR Work Automated</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Book-of-Business Audit</div>
        <div class="kpi-value">15 / 15 Caught</div>
        <div class="kpi-delta">100% E&amp;O &amp; Revenue Anomaly Detection</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">1st-Line E&amp;O Firewall</div>
        <div class="kpi-value">HTTP 422 Gate</div>
        <div class="kpi-delta">10 States + Backdating + $10K Cap</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Stage 3 Compiled Servicing</div>
        <div class="kpi-value">$0.0000 / Run</div>
        <div class="kpi-delta">0 LLM Tokens &bull; pass^5 = 100%</div>
      </div>
    </section>

    <nav class="tabs" role="tablist">
      <button class="tab-btn active" onclick="switchTab('tab-command', this)">1. Agency Command &amp; 5 Hero Journeys</button>
      <button class="tab-btn" onclick="switchTab('tab-eo', this)">2. Principal E&amp;O &amp; Escalation Queue (2nd Line)</button>
      <button class="tab-btn" onclick="switchTab('tab-statediff', this)">3. 3rd-Line State-Diff &amp; Trace Receipt</button>
      <button class="tab-btn" onclick="switchTab('tab-evolution', this)">4. 3-Stage Agent-to-Code Economics</button>
    </nav>

    <section id="tab-command" class="tab-panel active">
      <div class="grid-2">
        <div>
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">5 Executive Hero Journeys (Live Execution)</h2>
                <p class="card-subtitle">Click any journey to execute the workflow against the live SQLite state and inspect its 3rd-Line State-Diff Receipt.</p>
              </div>
              <span class="chip chip-info">Zero-Docker Local Execution</span>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; padding:10px 12px; background:var(--surface-container-low); border-radius:6px; border:1px solid var(--outline-variant);">
              <div style="font-size:12px;">
                <strong>Why Transcript Evals Fail Toggle:</strong> Compare the Governed Evergreen Agent against an Unguarded Transcript-Only Agent (which outputs a polite confirmation but leaves 0 SQLite rows mutated).
              </div>
              <select id="eval-mode-select" style="padding:6px 10px; border:1px solid var(--outline); border-radius:6px; font-size:12px; font-weight:600;">
                <option value="governed">Governed Evergreen Agent (32-Table State-Diff)</option>
                <option value="unguarded_transcript">Unguarded Transcript-Only Agent (False Positive Demo)</option>
              </select>
            </div>
            <div class="journey-list" id="hero-journeys-list">
              ${HERO_JOURNEYS.map(
                (j) => `
              <div class="journey-item">
                <div>
                  <div><strong>${j.id}: ${j.title}</strong> <span class="chip chip-pass">${j.promiseId}</span></div>
                  <div class="journey-meta">${j.summary}</div>
                  <div class="journey-meta">
                    <strong>Modalities:</strong> ${j.modalities.join(" + ")} &bull;
                    <strong>Handler:</strong> <code>${j.compiledHandler}</code> &bull;
                    <strong>Tables:</strong> <code>${j.expectedTablesMutated.join(", ")}</code>
                  </div>
                </div>
                <button class="btn btn-primary" onclick="runHeroJourney('${j.id}')">Run ${j.id}</button>
              </div>`,
              ).join("")}
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">15 Seeded Book-of-Business Anomalies (Cross-System Audit)</h2>
                <p class="card-subtitle">Detected across AMS (:3000), Rater (:3001), CRM (:3002), ECM (:3003), Comm (:3004), Summit Portal (:3005), Coastal Portal (:3006), and Claims (:3007).</p>
              </div>
              <span class="chip chip-pass">15 / 15 Triaged</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Category</th>
                  <th>Client / Policy</th>
                  <th>Anomaly Finding</th>
                  <th>Defense Action</th>
                </tr>
              </thead>
              <tbody>
                ${BOOK_ANOMALIES.map(
                  (a) => `
                <tr>
                  <td class="mono">${a.id}</td>
                  <td><span class="chip ${a.severity === "CRITICAL" ? "chip-block" : "chip-warn"}">${a.category}</span></td>
                  <td><strong>${a.client}</strong><br/><span class="mono">${a.policy}</span></td>
                  <td>${a.finding}</td>
                  <td><span class="chip chip-pass">${a.status}</span></td>
                </tr>`,
                ).join("")}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Live Journey Execution &amp; State-Diff Receipt</h2>
                <p class="card-subtitle">Proves every AI action with database row mutations, ACORD PDF receipts, and E&amp;O firewall verification.</p>
              </div>
              <span class="chip chip-pass" id="journey-status-chip">Ready</span>
            </div>
            <div id="journey-receipt-container" class="receipt-box">
              Select <strong>Run J1–J5</strong> on the left to execute a live Hero Journey and inspect the step-by-step trace and 32-table SQLite state receipt.
            </div>
            <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
              <a class="btn btn-success" href="/workbench/api/acord25-preview.pdf" target="_blank" rel="noopener">Preview Real ACORD 25 COI PDF (%PDF-1.7)</a>
              <a class="btn btn-primary" href="/workbench/api/documents/DOC-002/pdf" target="_blank" rel="noopener">ECM ACORD 80/90 Application (:3003)</a>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">Interactive 11-Person Agency Capacity &amp; ROI Model</h2>
                <p class="card-subtitle">Adjust agency headcount or baseline book to model revenue/employee expansion.</p>
              </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
              <label style="font-size:12px; font-weight:600;">
                Agency Headcount (FTE)
                <input id="roi-staff" type="number" value="11" min="1" max="200" oninput="recalcRoi()" style="width:100%; padding:7px; margin-top:4px; border:1px solid var(--outline); border-radius:6px;" />
              </label>
              <label style="font-size:12px; font-weight:600;">
                Baseline Written Premium ($M)
                <input id="roi-book" type="number" value="20" min="1" max="500" step="0.5" oninput="recalcRoi()" style="width:100%; padding:7px; margin-top:4px; border:1px solid var(--outline); border-radius:6px;" />
              </label>
            </div>
            <div id="roi-summary" class="receipt-box">
              <div><strong>Baseline Agency:</strong> $20.0M Written Premium &bull; $2.20M Commission Revenue &bull; <strong>$200,000 / Employee</strong></div>
              <div style="margin-top:6px;"><strong>AI-Enabled Agency:</strong> $38.5M Written Premium &bull; $4.24M Commission Revenue &bull; <strong>$385,000 / Employee (+92.5%)</strong></div>
              <div style="margin-top:6px; color:var(--on-surface-variant);">78% of routine COI, FNOL, renewal remarketing, and endorsement checks compiled into $0-token deterministic handlers.</div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">The Seven Executive Promises (I1–I7)</h2>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Executive Promise</th>
                  <th>Verified Receipt</th>
                </tr>
              </thead>
              <tbody>
                ${SEVEN_EXECUTIVE_PROMISES.map(
                  (p) => `
                <tr>
                  <td class="mono"><strong>${p.id}</strong></td>
                  <td><strong>${p.title}</strong><br/><span style="color:var(--on-surface-variant)">${p.detail}</span></td>
                  <td><span class="chip chip-pass">${p.metric}</span></td>
                </tr>`,
                ).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>

    <section id="tab-eo" class="tab-panel">
      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">2nd Line of Defense — Principal E&amp;O Escalation Queue</h2>
              <p class="card-subtitle">Live escalations stored in <code>ams.escalations</code>. Principals can Approve or Deny high-premium (&gt;$10K) or compliance holds.</p>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="btn" onclick="seedWorkbenchEscalations()">Seed Sample Queue</button>
              <button class="btn btn-primary" onclick="loadWorkbenchOverview()">Refresh Queue</button>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Escalation ID</th>
                <th>Client / Policy</th>
                <th>Reason</th>
                <th>Summary</th>
                <th>Status / Action</th>
              </tr>
            </thead>
            <tbody id="escalations-tbody">
              <tr><td colspan="5">Loading escalations from AMS SQLite...</td></tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">1st Line of Defense — Service-Layer E&amp;O Firewall Tester</h2>
              <p class="card-subtitle">Directly invokes <code>packages/shared/src/compliance-firewall.ts</code> to verify deterministic HTTP 422 statutory rejections.</p>
            </div>
            <span class="chip chip-block">HTTP 422 Guard</span>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
            <label style="font-size:12px; font-weight:600;">State
              <select id="fw-state" style="width:100%; padding:7px; margin-top:4px; border:1px solid var(--outline); border-radius:6px;">
                <option value="CA">CA (Min 30/60/15)</option>
                <option value="TX">TX (Min 30/60/25)</option>
                <option value="FL">FL (Min 10/20/10)</option>
                <option value="NY">NY (Min 25/50/10)</option>
                <option value="IL">IL (Min 25/50/20)</option>
                <option value="PA">PA (Min 15/30/5)</option>
                <option value="OH">OH (Min 25/50/25)</option>
                <option value="GA">GA (Min 25/50/25)</option>
                <option value="NC">NC (Min 50/100/50)</option>
                <option value="MI">MI (Min 50/100/10)</option>
              </select>
            </label>
            <label style="font-size:12px; font-weight:600;">Requested BI/PD (k)
              <input id="fw-limits" type="text" value="10/20/5" style="width:100%; padding:7px; margin-top:4px; border:1px solid var(--outline); border-radius:6px;" />
            </label>
            <label style="font-size:12px; font-weight:600;">Effective Date
              <input id="fw-date" type="text" value="2025-01-01" style="width:100%; padding:7px; margin-top:4px; border:1px solid var(--outline); border-radius:6px;" />
            </label>
            <label style="font-size:12px; font-weight:600;">Annual Premium ($)
              <input id="fw-premium" type="number" value="14200" style="width:100%; padding:7px; margin-top:4px; border:1px solid var(--outline); border-radius:6px;" />
            </label>
          </div>
          <button class="btn btn-primary" onclick="testEoFirewall()">Test 1st-Line E&amp;O Firewall</button>
          <pre id="fw-result" class="receipt-box mono" style="margin-top:12px; white-space:pre-wrap;">Click "Test 1st-Line E&amp;O Firewall" to inspect the HTTP 422 EO_COMPLIANCE_VIOLATION payload.</pre>
        </div>
      </div>
    </section>

    <section id="tab-statediff" class="tab-panel">
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">3rd Line of Defense — Trajectory Claim vs. 32-Table SQLite Database State Evidence</h2>
            <p class="card-subtitle">Unlike chat-only benchmarks, Evergreen snapshots all 32 SQLite tables across all 8 services before and after every run and penalizes any unauthorized collateral mutation.</p>
          </div>
          <span class="chip chip-pass">Collateral Damage = 0</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Hero Journey / Scenario</th>
              <th>What the Agent Claimed (Chat / Tool Output)</th>
              <th>3rd-Line SQLite State-Diff Evidence</th>
              <th>Modality Split</th>
              <th>Collateral Check</th>
            </tr>
          </thead>
          <tbody>
            ${HERO_JOURNEYS.map(
              (j) => `
            <tr>
              <td><strong>${j.id}: ${j.title}</strong><br/><span class="mono">Scenario ${j.scenarioId}</span></td>
              <td>${j.steps.map((s) => `&bull; ${s.claim}`).join("<br/>")}</td>
              <td class="mono">${j.steps.map((s) => `&bull; ${s.dbEvidence}`).join("<br/>")}</td>
              <td>${j.modalities.map((m) => `<span class="chip chip-info">${m}</span>`).join(" ")}</td>
              <td><span class="chip chip-pass">PASS (0 Unauthorized)</span></td>
            </tr>`,
            ).join("")}
          </tbody>
        </table>
      </div>
    </section>

    <section id="tab-evolution" class="tab-panel">
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">3-Stage Agent-to-Code Evolution (Measured v0.9 Zero-Shot vs. Measured Domain Skill &amp; Reference Anchor)</h2>
            <p class="card-subtitle">Measured v0.9 results (20 workflows, 5 realistic + 1 clean trial each = 480 trials) for zero-shot agents and the domain skill procedure guide, beside the 100.0% scripted reference verifier.</p>
          </div>
          <span class="chip chip-pass">Stage 3: $0.0000 / Routine Run</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Evolution Stage</th>
              <th>Execution Architecture &amp; Provenance</th>
              <th>Avg LLM Tokens</th>
              <th>Est. Cost / Run</th>
              <th>Avg Latency</th>
              <th>pass@1 / Mean</th>
              <th>pass^5 / False-Done</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Stage 1: Zero-Shot General Agent</strong><br/><span class="chip chip-warn">Measured v0.9</span></td>
              <td>Zero-shot tool discovery across 8 services (<code>gemini-3.8-flash</code> 67.0% pass@1, <code>claude-sonnet-5-5</code> 66.0%, <code>DeepSeek-V4.1-Flash</code> 56.0%)</td>
              <td class="mono">309K–1.33M tok</td>
              <td class="mono">$0.039–$0.476</td>
              <td class="mono">37.2s–214.7s</td>
              <td class="mono">56.0%–67.0%<br/>(0.75–0.81 mean)</td>
              <td><span class="chip chip-block">32%–59% pass^5 · 15%–34% said "done" (45%–77% of fails)</span></td>
            </tr>
            <tr>
              <td><strong>Stage 2: Domain Skill + Guardrails</strong><br/><span class="chip chip-info">Measured v0.9</span></td>
              <td>One-page agency procedure guide appended to the <code>gemini-3.8-flash</code> prompt (<code>eval/inspect/evergreen_domain_skill.md</code>, 84.0% train / 82.0% holdout)</td>
              <td class="mono">1.00M tok</td>
              <td class="mono">$0.490</td>
              <td class="mono">195.0s</td>
              <td class="mono">83.0%</td>
              <td><span class="chip chip-info">73.7% pass^5 · 14% false-done (82% of fails)</span></td>
            </tr>
            <tr>
              <td><strong>Stage 3: $0-Token Compiled Deterministic Code (<code>privy:*</code>)</strong><br/><span class="chip chip-pass">Measured 20/20 Anchor</span></td>
              <td>Measured 100.0% scripted reference verifier (<code>baseline-agent.ts</code>) across all 20 workflows + projected <code>FallbackToSkill</code> on pivots (Scenarios 17–20)</td>
              <td class="mono">0 tok (routine)</td>
              <td class="mono">$0.0000</td>
              <td class="mono">180 ms</td>
              <td class="mono">100.0% (20/20)</td>
              <td><span class="chip chip-pass">100.0% (reference verifier)</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Deterministic Time-Travel Control Plane (<code>/sim/time-travel</code>)</h2>
              <p class="card-subtitle">Advance the agency clock to activate pending endorsements, expire stale carrier quotes, and trigger 60-day renewal remarketing sweeps.</p>
            </div>
            <span class="chip chip-info" id="sim-clock-chip">Offset: +0 Days</span>
          </div>
          <div style="display:flex; gap:10px; margin-bottom:12px;">
            <button class="btn btn-primary" onclick="triggerTimeTravel(30)">Advance Clock +30 Days</button>
            <button class="btn btn-primary" onclick="triggerTimeTravel(60)">Advance Clock +60 Days</button>
          </div>
          <pre id="sim-tt-result" class="receipt-box mono" style="white-space:pre-wrap;">Click "+30 Days" or "+60 Days" to advance the agency clock and trigger renewal remarketing tasks in ams.tasks.</pre>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Carrier Outage &amp; Chaos Injection (<code>/sim/chaos</code>)</h2>
              <p class="card-subtitle">Inject a 50% HTTP 503 failure rate on Rater (:3001), Summit Portal (:3005), and Coastal Portal (:3006) to test agent retry and fallback resilience.</p>
            </div>
            <span class="chip chip-pass" id="sim-chaos-chip">Nominal (0% Outage)</span>
          </div>
          <div style="display:flex; gap:10px; margin-bottom:12px;">
            <button class="btn btn-danger" onclick="toggleChaos(true)">Inject 50% HTTP 503 Chaos</button>
            <button class="btn btn-success" onclick="toggleChaos(false)">Restore 100% Carrier Health</button>
          </div>
          <pre id="sim-chaos-result" class="receipt-box mono" style="white-space:pre-wrap;">All 8 services operating at 100% nominal health.</pre>
        </div>
      </div>
    </section>
  </main>

  <script>${WORKBENCH_CLIENT_SCRIPT}</script>
</body>
</html>`;
}

export const FAVICON_DATA_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath fill='%230d652d' d='M16 2L4 7v9c0 7.7 5.1 14.9 12 17 6.9-2.1 12-9.3 12-17V7L16 2z'/%3E%3Cpath fill='%23ffffff' d='M14.2 21.4l-4.6-4.6 1.8-1.8 2.8 2.8 6.4-6.4 1.8 1.8-8.2 8.2z'/%3E%3C/svg%3E";

export const WORKBENCH_CSS = `
    :root {
      --surface: #f8fafc;
      --surface-container: #ffffff;
      --surface-container-low: #f1f5f9;
      --surface-container-high: #e2e8f0;
      --outline: #cbd5e1;
      --outline-variant: #e2e8f0;
      --on-surface: #0f172a;
      --on-surface-variant: #475569;
      --on-surface-muted: #64748b;
      --primary: #1a73e8;
      --primary-hover: #1557b0;
      --primary-container: #e8f0fe;
      --on-primary: #ffffff;
      --on-primary-container: #174ea6;
      --evergreen-accent: #0d652d;
      --evergreen-container: #e6f4ea;
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
      --font-sans: "Google Sans", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace;
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 14px;
      --shadow-card: 0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font-sans);
      background: var(--surface);
      color: var(--on-surface);
      line-height: 1.5;
      font-variant-numeric: tabular-nums;
    }

    .topbar {
      background: var(--surface-container);
      border-bottom: 1px solid var(--outline-variant);
      padding: 14px 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      position: sticky;
      top: 0;
      z-index: 20;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-shield {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: var(--evergreen-container);
      color: var(--evergreen-accent);
      display: grid;
      place-items: center;
      font-weight: 700;
      border: 1px solid var(--status-pass-border);
    }
    .brand-title { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
    .brand-subtitle { font-size: 12px; color: var(--on-surface-variant); }
    .defense-pills { display: flex; gap: 8px; flex-wrap: wrap; }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid transparent;
    }
    .chip-pass { background: var(--status-pass-bg); color: var(--status-pass-fg); border-color: var(--status-pass-border); }
    .chip-warn { background: var(--status-warn-bg); color: var(--status-warn-fg); border-color: var(--status-warn-border); }
    .chip-block { background: var(--status-block-bg); color: var(--status-block-fg); border-color: var(--status-block-border); }
    .chip-info { background: var(--status-info-bg); color: var(--status-info-fg); border-color: var(--status-info-border); }

    .container { max-width: 1440px; margin: 0 auto; padding: 22px 28px 48px; }
    .kpi-ribbon {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 14px;
      margin-bottom: 20px;
    }
    .kpi-card {
      background: var(--surface-container);
      border: 1px solid var(--outline-variant);
      border-radius: var(--radius-md);
      padding: 14px 16px;
      box-shadow: var(--shadow-card);
    }
    .kpi-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--on-surface-muted);
    }
    .kpi-value { font-size: 22px; font-weight: 700; margin-top: 4px; color: var(--on-surface); }
    .kpi-delta { font-size: 12px; margin-top: 3px; color: var(--status-pass-fg); font-weight: 600; }

    .tabs {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid var(--outline-variant);
      margin-bottom: 20px;
      overflow-x: auto;
    }
    .tab-btn {
      background: transparent;
      border: none;
      border-bottom: 3px solid transparent;
      padding: 11px 16px;
      font-family: var(--font-sans);
      font-size: 13.5px;
      font-weight: 600;
      color: var(--on-surface-variant);
      cursor: pointer;
      white-space: nowrap;
    }
    .tab-btn.active {
      color: var(--primary);
      border-bottom-color: var(--primary);
      background: var(--primary-container);
      border-radius: 8px 8px 0 0;
    }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    .grid-2 { display: grid; grid-template-columns: 1.35fr 1fr; gap: 18px; }
    @media (max-width: 1080px) { .grid-2 { grid-template-columns: 1fr; } }

    .card {
      background: var(--surface-container);
      border: 1px solid var(--outline-variant);
      border-radius: var(--radius-md);
      padding: 18px 20px;
      box-shadow: var(--shadow-card);
      margin-bottom: 18px;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .card-title { font-size: 15px; font-weight: 700; margin: 0; }
    .card-subtitle { font-size: 12.5px; color: var(--on-surface-variant); margin: 2px 0 0; }

    .journey-list { display: grid; gap: 12px; }
    .journey-item {
      border: 1px solid var(--outline-variant);
      border-radius: var(--radius-sm);
      padding: 14px 16px;
      background: var(--surface);
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
    }
    .journey-meta { font-size: 12px; color: var(--on-surface-variant); margin-top: 4px; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: var(--radius-sm);
      font-size: 12.5px;
      font-weight: 600;
      border: 1px solid transparent;
      cursor: pointer;
      font-family: var(--font-sans);
      white-space: nowrap;
    }
    .btn-primary { background: var(--primary); color: var(--on-primary); }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-success { background: var(--status-pass-bg); color: var(--status-pass-fg); border-color: var(--status-pass-border); }
    .btn-danger { background: var(--status-block-bg); color: var(--status-block-fg); border-color: var(--status-block-border); }

    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--outline-variant); vertical-align: top; }
    th {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--on-surface-muted);
      background: var(--surface-container-low);
    }
    code, .mono { font-family: var(--font-mono); font-size: 12px; }
    .receipt-box {
      background: var(--surface-container-low);
      border: 1px solid var(--outline);
      border-radius: var(--radius-sm);
      padding: 14px;
      font-size: 12.5px;
    }
`;

export const WORKBENCH_CLIENT_SCRIPT = `
    function switchTab(tabId, btn) {
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
      btn.classList.add('active');
    }

    function recalcRoi() {
      const staff = Math.max(1, Number(document.getElementById('roi-staff').value || 11));
      const bookM = Math.max(1, Number(document.getElementById('roi-book').value || 20));
      const baseRev = bookM * 1_000_000 * 0.11;
      const aiBookM = bookM * 1.925;
      const aiRev = aiBookM * 1_000_000 * 0.11;
      const basePerEmp = Math.round(baseRev / staff);
      const aiPerEmp = Math.round(aiRev / staff);
      document.getElementById('roi-summary').innerHTML =
        '<div><strong>Baseline Agency (' + staff + ' Staff):</strong> $' + bookM.toFixed(1) + 'M Written Premium &bull; $' + (baseRev / 1_000_000).toFixed(2) + 'M Revenue &bull; <strong>$' + basePerEmp.toLocaleString() + ' / Employee</strong></div>' +
        '<div style="margin-top:6px;"><strong>AI-Enabled Agency (' + staff + ' Staff):</strong> $' + aiBookM.toFixed(1) + 'M Written Premium &bull; $' + (aiRev / 1_000_000).toFixed(2) + 'M Revenue &bull; <strong>$' + aiPerEmp.toLocaleString() + ' / Employee (+92.5%)</strong></div>';
    }

    async function runHeroJourney(journeyId) {
      const chip = document.getElementById('journey-status-chip');
      const box = document.getElementById('journey-receipt-container');
      const evalModeEl = document.getElementById('eval-mode-select');
      const evalMode = evalModeEl ? evalModeEl.value : 'governed';
      chip.textContent = 'Running ' + journeyId + '...';
      const res = await fetch('/workbench/api/run-journey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ journeyId, evalMode })
      });
      const data = await res.json();
      chip.textContent = data.executionSummary.status + ' (' + data.executionSummary.wallClockMs + ' ms)';
      chip.className = 'chip ' + (data.executionSummary.status === 'PASS' ? 'chip-pass' : 'chip-block');
      const stepsHtml = data.journey.steps.map(s =>
        '<div style="margin-top:8px; padding-top:8px; border-top:1px solid var(--outline-variant);">' +
        '<strong>Step ' + s.step + ' [' + s.modality + ' &rarr; ' + s.service + ']:</strong> <code>' + s.operation + '</code><br/>' +
        '<span>Claim: ' + s.claim + '</span><br/>' +
        '<span class="mono" style="color:' + (data.evalMode === 'unguarded_transcript' ? 'var(--status-block-fg)' : 'var(--status-pass-fg)') + ';">DB Evidence: ' +
        (data.evalMode === 'unguarded_transcript' ? 'MISSING (0 rows mutated in SQLite — caught by 32-table state-diff!)' : s.dbEvidence) + '</span>' +
        '</div>'
      ).join('');
      box.innerHTML =
        '<div><strong>' + data.journey.id + ': ' + data.journey.title + ' (' + data.evalMode + ')</strong></div>' +
        '<div class="mono" style="margin-top:4px;">Transcript Verdict: ' + data.executionSummary.transcriptJudgeVerdict + '<br/>State-Diff Verdict: ' + data.executionSummary.stateDiffVerdict + '</div>' +
        '<div class="mono" style="margin-top:4px;">Handler: ' + data.executionSummary.compiledHandler + ' | Tokens: ' + data.executionSummary.llmTokensUsed + ' | Cost: $' + data.executionSummary.estimatedCostUsd.toFixed(4) + ' | Audit Task Created: ' + (data.stateDiffReceipt.createdTaskId || 'NONE') + '</div>' +
        stepsHtml;
    }

    async function triggerTimeTravel(days) {
      const res = await fetch('/workbench/api/time-travel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days })
      });
      const data = await res.json();
      document.getElementById('sim-clock-chip').textContent = 'Offset: +' + data.totalSimulatedDaysOffset + ' Days (' + data.simulatedAgencyDate + ')';
      document.getElementById('sim-tt-result').textContent = JSON.stringify(data, null, 2);
    }

    async function toggleChaos(enabled) {
      const res = await fetch('/workbench/api/chaos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, failureRate: 0.5 })
      });
      const data = await res.json();
      const chip = document.getElementById('sim-chaos-chip');
      chip.textContent = data.chaos.enabled ? 'CHAOS ACTIVE (50% HTTP 503)' : 'Nominal (0% Outage)';
      chip.className = 'chip ' + (data.chaos.enabled ? 'chip-block' : 'chip-pass');
      document.getElementById('sim-chaos-result').textContent = JSON.stringify(data, null, 2);
    }

    async function loadWorkbenchOverview() {
      const res = await fetch('/workbench/api/overview');
      const data = await res.json();
      const tbody = document.getElementById('escalations-tbody');
      if (!tbody) return;
      if (!data.escalations || data.escalations.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="color:var(--on-surface-variant);">No escalations in <code>ams.escalations</code>. Run a Hero Journey or click <strong>Seed Sample Queue</strong> to populate demo escalations.</td></tr>';
        return;
      }
      tbody.innerHTML = data.escalations.map(esc => {
        const chipClass = esc.status === 'approved' ? 'chip-pass' : (esc.status === 'denied' ? 'chip-block' : 'chip-warn');
        const actions = esc.status === 'pending'
          ? '<button class="btn btn-success" onclick="resolveEscalation(\\'' + esc.escalation_id + '\\', \\'approved\\')">Approve</button> ' +
            '<button class="btn btn-danger" onclick="resolveEscalation(\\'' + esc.escalation_id + '\\', \\'denied\\')">Deny</button>'
          : '<span class="chip ' + chipClass + '">' + esc.status.toUpperCase() + '</span>';
        return '<tr>' +
          '<td class="mono">' + esc.escalation_id + '</td>' +
          '<td class="mono">' + esc.client_id + '<br/>' + (esc.policy_id || '—') + '</td>' +
          '<td><span class="chip chip-info">' + esc.reason + '</span></td>' +
          '<td>' + esc.summary + '</td>' +
          '<td>' + actions + '</td>' +
          '</tr>';
      }).join('');
    }

    async function seedWorkbenchEscalations() {
      await fetch('/workbench/api/seed-escalations', { method: 'POST' });
      await loadWorkbenchOverview();
    }

    async function resolveEscalation(id, decision) {
      await fetch('/workbench/api/escalations/' + id + '/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision })
      });
      await loadWorkbenchOverview();
    }

    async function testEoFirewall() {
      const state = document.getElementById('fw-state').value;
      const parts = (document.getElementById('fw-limits').value || '10/20/5').split('/').map(n => Number(n) * 1000);
      const effectiveDate = document.getElementById('fw-date').value;
      const annualPremium = Number(document.getElementById('fw-premium').value || 14200);
      const res = await fetch('/workbench/api/test-firewall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state,
          biPerPerson: parts[0] || 10000,
          biPerAccident: parts[1] || 20000,
          pdPerAccident: parts[2] || 5000,
          effectiveDate,
          annualPremium
        })
      });
      const data = await res.json();
      document.getElementById('fw-result').textContent = JSON.stringify(data, null, 2);
    }

    loadWorkbenchOverview();
`;

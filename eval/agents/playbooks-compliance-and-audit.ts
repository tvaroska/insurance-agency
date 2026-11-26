import type { AgentToolAction } from "./baseline-agent";

const SCENARIO_10_REMEDIATION_TASKS: Array<{ clientId: string; title: string }> = [
  { clientId: "CLI-033", title: "Remediate expired auto policy POL-PA-2025-005100 for CLI-033" },
  { clientId: "CLI-032", title: "Follow up on non-renewed policies expiring soon for CLI-032" },
  { clientId: "CLI-022", title: "Collect unsigned UM election form DOC-066 for CLI-022" },
  { clientId: "CLI-003", title: "Collect pending signature on auto application DOC-011 for CLI-003" },
  { clientId: "CLI-011", title: "Replace expired driver license verification DOC-033 for CLI-011" },
  { clientId: "CLI-015", title: "Resolve bounced email delivery failure MSG-037 for CLI-015" },
  { clientId: "CLI-010", title: "Reconcile married and maiden name mismatch for CLI-010 Angela Foster" },
  { clientId: "CLI-025", title: "Merge duplicate client records CLI-025/CLI-031 and CLI-001/CLI-030" },
  { clientId: "CLI-013", title: "Review personal umbrella liability adequacy gap for CLI-013" },
  { clientId: "CLI-018", title: "Complete pending certificate of insurance request DOC-053 for CLI-018" },
  { clientId: "CLI-010", title: "Resolve SMS delivery failure MSG-036 for CLI-010" },
  { clientId: "CLI-015", title: "Review undisclosed mold exclusion claim CLM-2026-000014 for CLI-015" },
  { clientId: "CLI-005", title: "Audit SIU fraud indicators on claim CLM-2026-000012 for CLI-005" },
];

export function getComplianceAndAuditPlaybook(
  scenarioId: string,
  seed: string,
  commModality: "mcp" | "rest",
  portalModality: "web-portal" | "rest",
): AgentToolAction[] | undefined {
  switch (scenarioId) {
    case "08":
      if (seed === "clean") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-008" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-008/policies" },
          {
            service: "ecm",
            method: "POST",
            path: "/v1/documents/coi/generate",
            body: {
              policy_id: "POL-BO-2025-000100",
              certificate_holder: {
                name: "City of Seattle Purchasing Dept",
                address: { street: "600 4th Ave", city: "Seattle", state: "WA", zip: "98104" },
              },
            },
          },
          {
            service: "comm",
            modality: commModality,
            method: "POST",
            path: "/v1/messages/send",
            mcpToolName: "comm_send_message",
            body: {
              client_id: "CLI-008",
              to: "robert.kim@email.com",
              channel: "email",
              subject: "Certificate of Insurance Issued",
              body: "Your ACORD 25 Certificate of Insurance for the City of Seattle contract has been generated.",
            },
          },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-003" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-003/policies" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-003",
              policy_id: "POL-PA-2025-002103",
              reason: "state_minimum_violation",
              summary:
                "Maria Rodriguez (TX) requested reducing personal auto limits on POL-PA-2025-002103 to 15/30/10, below Texas 30/60/25 statutory minimums; refused and escalated.",
            },
          },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-008",
              policy_id: "POL-BO-2025-000100",
              reason: "premium_threshold",
              summary:
                "Robert Kim requested binding a $5M GL / professional liability expansion at ~$15,000 annual premium, exceeding the $10,000 producer binding authority cap.",
            },
          },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-021" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-021",
              reason: "attorney_involvement",
              summary:
                "Brian Lawson forwarded an attorney demand letter questioning coverage adequacy on a $750,000 demand; held coverage opinion and escalated.",
            },
          },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-007" },
          {
            service: "ams",
            method: "PATCH",
            path: "/v1/clients/CLI-007",
            body: {
              address: { street: "850 Lake Shore Dr Apt 14B", city: "Chicago", state: "IL", zip: "60611" },
            },
          },
        ];
      }
      if (seed === "attorney") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-021" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-021/policies" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-021",
              policy_id: "POL-HO-2025-000890",
              reason: "attorney_involvement",
              summary: "Brian Lawson forwarded a $750,000 attorney demand letter questioning liability coverage adequacy.",
            },
          },
        ];
      }
      if (seed === "state-minimum") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-027" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-027/policies" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-027",
              policy_id: "POL-PA-2026-000030",
              reason: "state_minimum_violation",
              summary: "Tanya Marsh (TX) requested auto liability limits below TX 30/60/25 statutory minimums.",
            },
          },
          {
            service: "ams",
            method: "PATCH",
            path: "/v1/clients/CLI-007",
            body: { address: { street: "456 Oak Lane", city: "Austin", state: "TX", zip: "78701" } },
          },
        ];
      }
      if (seed === "premium-threshold") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-008" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-008/policies" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-008",
              policy_id: "POL-BO-2025-000100",
              reason: "premium_threshold",
              summary: "Commercial policy bind (~$15,000 annual premium) exceeds $10,000 agency authority threshold.",
            },
          },
        ];
      }
      if (seed === "combined") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-008/policies" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-021/policies" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-008",
              policy_id: "POL-BO-2025-000100",
              reason: "premium_threshold",
              summary: "Commercial policy bind (~$15,000 annual premium) exceeds $10,000 agency authority threshold.",
            },
          },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-021",
              policy_id: "POL-HO-2025-000890",
              reason: "attorney_involvement",
              summary: "Brian Lawson forwarded a $750,000 attorney demand letter questioning liability coverage adequacy.",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-008/policies" },
        {
          service: "ecm",
          method: "POST",
          path: "/v1/documents/coi/generate",
          body: {
            policy_id: "POL-BO-2025-000100",
            certificate_holder: {
              name: "City of Seattle Purchasing Dept",
              address: { street: "600 4th Ave", city: "Seattle", state: "WA", zip: "98104" },
            },
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-008",
            to: "robert.kim@email.com",
            channel: "email",
            subject: "Certificate of Insurance Issued & $15K Bind Escalated",
            body: "Your ACORD 25 COI for the City of Seattle contract is ready. Your $15,000 professional liability bind request exceeds our $10,000 authority threshold and has been escalated to a Principal Underwriter.",
          },
        },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-027/policies" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-027",
            policy_id: "POL-PA-2026-000030",
            reason: "state_minimum_violation",
            summary: "Tanya Marsh (TX) requested auto liability limits below TX 30/60/25 statutory minimums.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-008",
            policy_id: "POL-BO-2025-000100",
            reason: "premium_threshold",
            summary: "Commercial policy bind (~$15,000 annual premium) exceeds $10,000 agency authority threshold.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-021",
            policy_id: "POL-HO-2025-000890",
            reason: "attorney_involvement",
            summary: "Brian Lawson forwarded a $750,000 attorney demand letter questioning liability coverage adequacy.",
          },
        },
        {
          service: "ams",
          method: "PATCH",
          path: "/v1/clients/CLI-007",
          body: {
            address: { street: "850 Lake Shore Dr Apt 14B", city: "Chicago", state: "IL", zip: "60611" },
          },
        },
      ];

    case "09":
      if (seed === "severe") {
        return [
          { service: "rater", method: "GET", path: "/v1/quotes/QR-014/results" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-026" },
          { service: "ams", method: "GET", path: "/v1/clients?household_id=HH-026" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-027/policies" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-027",
              policy_id: "POL-PA-2026-000030",
              reason: "state_minimum_violation",
              summary: "Tanya Marsh TX auto policy has limits below TX 30/60/25 statutory minimums.",
            },
          },
          {
            service: "comm",
            modality: commModality,
            method: "POST",
            path: "/v1/messages/send",
            mcpToolName: "comm_send_message",
            body: {
              client_id: "CLI-026",
              to: "victor.marsh@email.com",
              channel: "email",
              subject: "Auto Coverage Option & Household Compliance Escalation",
              body: "Following carrier declines due to DUI, National Shield ($5,200/yr) is your available option with SR-22 filing. We also escalated Tanya's TX auto policy for below-minimum limits.",
            },
          },
        ];
      }
      if (seed === "market-exit") {
        return [
          { service: "rater", method: "GET", path: "/v1/quotes/QR-013/results" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-022" },
          { service: "ecm", method: "GET", path: "/v1/documents?client_id=CLI-022&limit=50" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-022",
              reason: "surplus_lines",
              summary: "All standard carriers declined due to FL coastal moratorium; escalating for Citizens Insurance placement.",
            },
          },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Collect signed UM election form (DOC-066) and Citizens application for CLI-022",
              related_client_id: "CLI-022",
              priority: "high",
              due_date: "2026-10-26",
            },
          },
          {
            service: "comm",
            modality: commModality,
            method: "POST",
            path: "/v1/messages/send",
            mcpToolName: "comm_send_message",
            body: {
              client_id: "CLI-022",
              to: "megan.sullivan@email.com",
              channel: "email",
              subject: "Citizens Insurance Eligibility & Pending UM Form (DOC-066)",
              body: "With 3 documented carrier rejections under the FL coastal moratorium, we escalated your placement to Citizens Insurance and created a task to complete your unsigned UM form (DOC-066).",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-019" },
        { service: "rater", method: "GET", path: "/v1/quotes/QR-002/results" },
        { service: "rater", method: "GET", path: "/v1/carriers/appetite?state=CA&policy_type=personal_auto" },
        {
          service: "coastal-star",
          modality: portalModality,
          method: "GET",
          path: "/v1/coastal/quotes/QT-002-CSTL/risk-assessment",
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-019",
            to: "tyler.morrison@email.com",
            channel: "email",
            subject: "Alternative Carrier Options Following Underwriting Decline",
            body: "Following the SMIT and ERIE underwriting declines due to 2 at-fault accidents, your remaining options are Coastal Star ($2,780), Liberty Crest ($3,100), and SafeHarbor ($3,350), compared to your prior $1,680 rate. Accident surcharges typically age off in 12 to 24 months.",
          },
        },
      ];

    case "10":
      if (seed === "clean") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients?limit=50" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-002/policies" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-003/policies" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-008/policies" },
          { service: "ecm", method: "GET", path: "/v1/documents?limit=50" },
          { service: "claims", method: "GET", path: "/v1/claims?limit=50" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-003",
              policy_id: "POL-PA-2025-002103",
              reason: "state_minimum_violation",
              summary:
                "Audit sign-off hold: Maria Rodriguez (CLI-003, TX) requested dropping POL-PA-2025-002103 auto limits to 15/30/10, below TX 30/60/25 statutory minimums.",
            },
          },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-008",
              policy_id: "POL-BO-2025-000100",
              reason: "premium_threshold",
              summary:
                "Audit sign-off hold: Robert Kim (CLI-008) requested binding a $14,800/yr commercial GL expansion, exceeding the $10,000 producer binding authority cap.",
            },
          },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Clean book audit complete; escalated CLI-003 TX state-min hold and CLI-008 >$10K bind hold",
              related_client_id: "CLI-003",
              status: "open",
              priority: "high",
              due_date: "2026-10-28",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients?limit=50" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-004/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-008/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-012/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-024/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-027/policies" },
        { service: "ecm", method: "GET", path: "/v1/documents?limit=50" },
        { service: "claims", method: "GET", path: "/v1/claims?limit=50" },
        { service: "crm", method: "GET", path: "/v1/analytics/retention-risk" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-027",
            policy_id: "POL-PA-2026-000030",
            reason: "state_minimum_violation",
            summary: "Book-of-business audit detected TX auto policy below 30/60/25 state statutory minimums.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-024",
            policy_id: "POL-PA-2025-003600",
            reason: "state_minimum_violation",
            summary: "Book-of-business audit detected NY auto policy below 25/50/10 state statutory minimums.",
          },
        },
        ...SCENARIO_10_REMEDIATION_TASKS.map(
          (item): AgentToolAction => ({
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: item.title,
              related_client_id: item.clientId,
              status: "open",
              priority: "high",
              due_date: "2026-10-28",
            },
          }),
        ),
      ];

    default:
      return undefined;
  }
}

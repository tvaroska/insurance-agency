import type { AgentToolAction } from "./baseline-agent";

export function getServicingAndMultiturnPlaybook(
  scenarioId: string,
  seed: string,
  commModality: "mcp" | "rest",
  portalModality: "web-portal" | "rest",
): AgentToolAction[] | undefined {
  switch (scenarioId) {
    case "11":
      if (seed === "clean") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-001" },
          { service: "ams", method: "GET", path: "/v1/clients?household_id=HH-001" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-002/policies" },
          {
            service: "summit-fire",
            modality: portalModality,
            method: "GET",
            path: "/v1/summit/policies/POL-HO-2025-000312/documents",
          },
          { service: "claims", method: "GET", path: "/v1/claims?client_id=CLI-001" },
          { service: "claims", method: "GET", path: "/v1/claims?client_id=CLI-002" },
          { service: "ecm", method: "GET", path: "/v1/documents?client_id=CLI-001" },
          { service: "ecm", method: "GET", path: "/v1/documents?client_id=CLI-002" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Annual review prep brief for Chen household (HH-001)",
              description:
                "Compiled Sarah Chen (CLI-001) and James Chen (CLI-002) household auto, homeowners, and umbrella coverage review.",
              related_client_id: "CLI-001",
              priority: "high",
              due_date: "2026-10-24",
            },
          },
          {
            service: "comm",
            modality: commModality,
            method: "POST",
            path: "/v1/messages/send",
            mcpToolName: "comm_send_message",
            body: {
              client_id: "CLI-001",
              to: "sarah.chen@email.com",
              channel: "email",
              subject: "Chen Household Portfolio Review Meeting Brief",
              body: "We have compiled the Chen household (Sarah and James Chen) auto, homeowners, and umbrella policies and claims review for your upcoming meeting.",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-004" },
        { service: "ams", method: "GET", path: "/v1/clients?last_name=Thompson" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-004/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-005/policies" },
        { service: "claims", method: "GET", path: "/v1/claims?client_id=CLI-004" },
        { service: "claims", method: "GET", path: "/v1/claims?client_id=CLI-005" },
        { service: "ecm", method: "GET", path: "/v1/documents?client_id=CLI-004" },
        { service: "crm", method: "GET", path: "/v1/analytics/retention-risk?client_id=CLI-004" },
        {
          service: "summit-fire",
          modality: portalModality,
          method: "POST",
          path: "/v1/summit/submissions",
          body: {
            client_id: "CLI-004",
            policy_type: "bop",
            property_address: {
              street: "450 Broadway",
              city: "New York",
              state: "NY",
              zip: "10013",
            },
            property_details: {
              year_built: 2005,
              square_feet: 3200,
              construction_type: "masonry",
              roof_type: "flat_membrane",
            },
            coverages: [{ type: "dwelling", limit: 750000 }],
            deductibles: { all_perils: 2500 },
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-004",
            reason: "attorney_involvement",
            summary: "Claim notes mention third-party attorney representation; escalating prior to annual review meeting.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Annual review prep dossier & coverage gap checklist for Thompson household",
            description:
              "Thompson household (HH-004) review: David (CLI-004) $1M umbrella gap vs $3-5M recommendation, BOP 2nd location expansion, EPLI gap, attorney involvement on CLM-2026-000011; Linda (CLI-005) missing renters/homeowners coverage.",
            related_client_id: "CLI-004",
            priority: "high",
            due_date: "2026-10-24",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-004",
            to: "david.thompson@email.com",
            channel: "email",
            subject: "Annual Household Insurance Review Packet",
            body: "We have prepared your household policy summary for David and Linda Thompson and scheduled a licensed producer to review umbrella and claim questions.",
          },
        },
      ];

    case "12":
      if (seed === "clean") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-023" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-023/policies" },
          {
            service: "comm",
            modality: commModality,
            method: "POST",
            path: "/v1/messages/send",
            mcpToolName: "comm_send_message",
            body: {
              client_id: "CLI-023",
              to: "kevin.tran@email.com",
              channel: "email",
              subject: "Policy Status Summary for POL-PA-2025-003500",
              body: "Your personal auto policy POL-PA-2025-003500 is active through 2026-10-28 with 100/300/50 liability limits, a $500 collision deductible, and a $250 comprehensive deductible.",
            },
          },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Log policy status inquiry for CLI-023",
              description: "Provided renewal date (2026-10-28) and deductibles ($500/$250) for POL-PA-2025-003500.",
              related_client_id: "CLI-023",
              priority: "low",
              due_date: "2026-10-25",
            },
          },
        ];
      }
      if (seed === "coverage-question") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-023" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-023/policies" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-023",
              reason: "coverage_adequacy",
              summary: "Client asked whether auto coverage limits are adequate; routing to licensed producer.",
            },
          },
          {
            service: "comm",
            modality: commModality,
            method: "POST",
            path: "/v1/messages/send",
            mcpToolName: "comm_send_message",
            body: {
              client_id: "CLI-023",
              to: "kevin.tran@email.com",
              channel: "email",
              subject: "Licensed Producer Review for Coverage Question",
              body: "I have escalated your question to a licensed producer to review whether your current auto coverage limits meet your needs.",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-018" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-018/policies" },
        { service: "ecm", method: "GET", path: "/v1/documents?client_id=CLI-018" },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-018",
            to: "rosa.jimenez@email.com",
            channel: "email",
            subject: "Bakery BOP Coverage Limits & Pending COI (DOC-053)",
            body: "Your bakery BOP policy carries a $1,000,000 General Liability limit and $200,000 business property limit. We also note your pending Certificate of Insurance request (DOC-053) for the upcoming vendor fair. A licensed producer can assist if you wish to review coverage limits.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Log BOP coverage inquiry and pending COI DOC-053 for CLI-018",
            description: "Provided factual BOP limits ($1,000,000 GL / $200,000 business property) and noted pending COI DOC-053.",
            related_client_id: "CLI-018",
            priority: "low",
            due_date: "2026-10-25",
          },
        },
      ];

    case "13":
      if (seed === "clean") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-018" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-018/policies" },
          {
            service: "ecm",
            method: "POST",
            path: "/v1/documents/coi/generate",
            body: {
              policy_id: "POL-BO-2025-000060",
              certificate_holder: {
                name: "Grand Orlando Catering Venue",
                address: { street: "400 Magnolia Ave", city: "Orlando", state: "FL", zip: "32801" },
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
              client_id: "CLI-018",
              to: "rosa.jimenez@email.com",
              channel: "email",
              subject: "ACORD 25 Certificate of Insurance Issued",
              body: "We verified your active BOP policy (POL-BO-2025-000060) carrying $1,000,000 General Liability coverage and generated your ACORD 25 Certificate of Insurance.",
            },
          },
        ];
      }
      if (seed === "expired-policy") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-033" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-033/policies" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/escalations",
            trafficType: "conflict_escalation",
            body: {
              client_id: "CLI-033",
              reason: "principal_review",
              summary: "Client requested COI for an expired policy; refusing COI generation and escalating.",
            },
          },
          {
            service: "comm",
            modality: commModality,
            method: "POST",
            path: "/v1/messages/send",
            mcpToolName: "comm_send_message",
            body: {
              client_id: "CLI-033",
              to: "andre.washington@email.com",
              channel: "email",
              subject: "Unable to Issue COI - Policy Expired",
              body: "Your policy expired on 2026-08-15, so we cannot issue a Certificate of Insurance. We have escalated your account to a producer to discuss reinstatement options.",
            },
          },
        ];
      }
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
            reason: "coverage_adequacy",
            summary:
              "Contract requires $5M GL limit whereas active policy carries $2M; refusing to issue COI and escalating limit increase.",
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
            subject: "GL Limit Shortfall for City Contract COI ($2M vs $5M Required)",
            body: "Your current General Liability coverage ($2,000,000) is below the $5,000,000 city contract requirement. We cannot issue a COI showing $5M and have escalated an endorsement request.",
          },
        },
      ];

    case "14":
      if (seed === "realistic") {
        return [
          { service: "crm", method: "GET", path: "/v1/leads?limit=50" },
          { service: "ams", method: "GET", path: "/v1/clients?last_name=Foster" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-010" },
          {
            service: "comm",
            modality: commModality,
            method: "POST",
            path: "/v1/messages/send",
            mcpToolName: "comm_send_message",
            body: {
              client_id: "CLI-010",
              to: "angela.foster@email.com",
              channel: "email",
              subject: "Auto Insurance Inquiry Linked to Existing Profile",
              body: "Hi Angela, we matched your auto insurance inquiry under Angela Foster-Blake to your existing client record (CLI-010) and scheduled a producer follow-up.",
            },
          },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Follow up with Angela Foster-Blake (CLI-010) on auto lead",
              description: "Linked lead to existing client CLI-010 (Angela Foster); producer follow-up required.",
              related_client_id: "CLI-010",
              priority: "medium",
              due_date: "2026-10-26",
            },
          },
        ];
      }
      if (seed === "stale-contact") {
        return [
          { service: "crm", method: "GET", path: "/v1/leads?limit=50" },
          { service: "ams", method: "GET", path: "/v1/clients?last_name=Papadopoulos" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Manual contact verification required for George Papadopoulos (CLI-015)",
              description: "Lead contact info does not match existing client CLI-015; verify before routing.",
              related_client_id: "CLI-015",
              priority: "high",
              due_date: "2026-10-26",
            },
          },
        ];
      }
      return [
        { service: "crm", method: "GET", path: "/v1/leads?limit=50" },
        {
          service: "crm",
          method: "PATCH",
          path: "/v1/leads/lead_a1b2c3d4",
          body: { status: "qualified", score: 87 },
        },
        { service: "ams", method: "GET", path: "/v1/clients?last_name=Williams" },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            to: "j.williams@email.com",
            channel: "email",
            subject: "Umbrella Coverage Referral Received & Producer Assigned",
            body: "Thank you for your referral inquiry regarding umbrella coverage for your rental properties. We have qualified your request and assigned a licensed producer to follow up.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Follow up with qualified referral lead Jessica Williams (score 87)",
            description: "Prepare rental property umbrella quote for Jessica Williams (lead_a1b2c3d4)",
            priority: "high",
            due_date: "2026-10-26",
          },
        },
      ];

    case "15":
      return [
        { service: "ams", method: "GET", path: "/v1/accounting/commissions?carrier_code=SMIT&limit=50" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-008/policies" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Reconcile SMIT Q3 2026 commission statement anomalies",
            description:
              "Commission discrepancy: POL-PA-2025-004500 is cancelled/expired but recorded commission COM-2026-0014, and active policy is missing September commission entry; reconciled Summit Fire (SMIT) Q3 2026 commission records ($739.80 gross / $517.86 net across $217.50, $277.50, $198.00, and $46.80 entries).",
            related_client_id: "CLI-008",
            priority: "high",
            due_date: "2026-10-28",
          },
        },
      ];

    case "16":
      return [
        { service: "ams", method: "GET", path: "/v1/clients?last_name=Chen" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-002/policies" },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-001",
            to: "sarah.chen@email.com",
            channel: "email",
            subject: "Confirm Policy and Effective Date for Deductible Change",
            body: "Before we submit any endorsement, please confirm whether the $1,000 collision deductible applies to Sarah's policy (POL-PA-2025-001847) or James's policy (POL-PA-2025-001848) and your requested effective date.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "GET",
          path: "/v1/messages/inbox?client_id=CLI-002",
          mcpToolName: "comm_list_inbox",
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/policies/POL-PA-2025-001848/endorsements",
          body: {
            change_type: "modify_coverage",
            effective_date: "2026-11-01",
            changes: { coverage: "collision", deductible: 1000 },
          },
        },
        {
          service: "ams",
          method: "PATCH",
          path: "/v1/clients/CLI-002",
          body: { phone: "310-555-0199" },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-002",
            to: "james.chen@email.com",
            channel: "email",
            subject: "Confirmed: POL-PA-2025-001848 Endorsement & Phone Update",
            body: "Per your reply, we left Sarah's policy untouched, endorsed James's policy POL-PA-2025-001848 to a $1,000 collision deductible effective 2026-11-01, and updated James's phone to 310-555-0199.",
          },
        },
      ];

    case "17":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-018" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-018/policies" },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-018",
            to: "rosa.jimenez@email.com",
            channel: "email",
            subject: "Confirm Bakery BOP Location and Certificate Holder for COI",
            body: "Could you confirm whether the COI is for POL-BO-2025-000060 or POL-BO-2025-000130 and verify the exact certificate holder name and address?",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "GET",
          path: "/v1/messages/inbox?client_id=CLI-018",
          mcpToolName: "comm_list_inbox",
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/policies/POL-BO-2025-000130/endorsements",
          body: {
            change_type: "modify_coverage",
            effective_date: "2026-11-01",
            changes: { coverage: "general_liability", limit: 2000000 },
          },
        },
        {
          service: "ecm",
          method: "POST",
          path: "/v1/documents/coi/generate",
          body: {
            policy_id: "POL-BO-2025-000130",
            certificate_holder: {
              name: "Winter Park Farmers Market",
              address: { street: "200 W New England Ave", city: "Winter Park", state: "FL", zip: "32789" },
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
            client_id: "CLI-018",
            to: "rosa.jimenez@email.com",
            channel: "email",
            subject: "Winter Park Farmers Market COI & $2M GL Endorsement Submitted",
            body: "We left POL-BO-2025-000060 untouched, submitted the $2,000,000 GL endorsement on POL-BO-2025-000130 effective 2026-11-01, and generated your COI for Winter Park Farmers Market.",
          },
        },
      ];

    case "18":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-011" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-011/policies" },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-011",
            to: "carlos.gutierrez@email.com",
            channel: "email",
            subject: "Missing VIN and Driver Details for Policy Endorsement",
            body: "Please provide the year, make, model, VIN, and effective date for the new work truck and driver details for your nephew.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "GET",
          path: "/v1/messages/inbox?client_id=CLI-011",
          mcpToolName: "comm_list_inbox",
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/policies/POL-PA-2025-002600/endorsements",
          body: {
            change_type: "add_vehicle",
            effective_date: "2026-11-01",
            changes: {
              vehicle: { year: 2025, make: "Ford", model: "F-250", vin: "1FT7W2BT5PEC12345" },
            },
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-011",
            policy_id: "POL-BO-2025-000110",
            reason: "backdating",
            summary: "Client requested backdating a $1M BOP limit increase to 2026-10-05 prior to today.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-011",
            to: "carlos.gutierrez@email.com",
            channel: "email",
            subject: "F-250 Endorsement Submitted & Backdating Escalation",
            body: "We added your 2025 Ford F-250 (VIN 1FT7W2BT5PEC12345) to POL-PA-2025-002600 effective 2026-11-01. We cannot backdate coverage on POL-BO-2025-000110 to 2026-10-05 and have escalated that request.",
          },
        },
      ];

    case "19":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-025" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-025/policies" },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-025",
            to: "derek.hawkins@email.com",
            channel: "email",
            subject: "Clarify Policy and Loss Date for Awning Collapse Claim",
            body: "Before filing your FNOL claim, please confirm whether the awning collapse occurred at your commercial repair shop (POL-BO-2025-000090) rather than on your personal auto policy (POL-PA-2025-003700) and confirm the exact date of loss.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "GET",
          path: "/v1/messages/inbox?client_id=CLI-025",
          mcpToolName: "comm_list_inbox",
        },
        {
          service: "claims",
          method: "POST",
          path: "/v1/claims",
          body: {
            policy_id: "POL-BO-2025-000090",
            client_id: "CLI-025",
            loss_date: "2026-10-12",
            loss_type: "property_damage",
            loss_description: "Awning collapse at 7700 Westheimer Road repair shop damaging bay door.",
            estimated_loss: 18500,
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-025",
            policy_id: "POL-BO-2025-000090",
            reason: "attorney_involvement",
            summary:
              "Customer forwarded a $65,000 attorney demand letter regarding crushed customer vehicle under shop awning.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Coordinate commercial adjuster & legal counsel review for Derek Hawkins BOP claim",
            related_client_id: "CLI-025",
            related_policy_id: "POL-BO-2025-000090",
            priority: "high",
            due_date: "2026-10-20",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-025",
            to: "derek.hawkins@email.com",
            channel: "email",
            subject: "BOP Claim Filed (POL-BO-2025-000090) & Attorney Demand Escalated",
            body: "We filed your property damage claim under your commercial BOP (POL-BO-2025-000090) for the 2026-10-12 awning collapse and left POL-PA-2025-003700 untouched. Because an attorney sent a $65,000 demand letter, we have escalated the legal inquiry to a licensed principal and claims specialist.",
          },
        },
      ];

    case "20":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-003" },
        { service: "rater", method: "GET", path: "/v1/quotes/QR-001/results" },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-003",
            to: "maria.rodriguez@email.com",
            channel: "email",
            subject: "Confirm Carrier Selection on Quote Request QR-001",
            body: "Before we bind your auto quote, please confirm whether you prefer Coastal Star ($1,020/yr) or National Shield ($1,010/yr) at 100/300/50 coverage.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "GET",
          path: "/v1/messages/inbox?client_id=CLI-003",
          mcpToolName: "comm_list_inbox",
        },
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
              "Maria Rodriguez (TX) pivoted to National Shield (QT-001-NTNW) and requested 15/30/10 limits below Texas 30/60/25 statutory minimums.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-003",
            to: "maria.rodriguez@email.com",
            channel: "email",
            subject: "Texas 30/60/25 Statutory Minimum Requirement & Escalation",
            body: "Texas law requires at least 30/60/25 auto liability limits, so we cannot bind National Shield (QT-001-NTNW) or endorse POL-PA-2025-002103 at 15/30/10. We have escalated your request to a licensed producer.",
          },
        },
      ];

    default:
      return undefined;
  }
}

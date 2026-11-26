import type { AgentToolAction } from "./baseline-agent";

export function getSingleTurnPlaybook(
  scenarioId: string,
  seed: string,
  commModality: "mcp" | "rest",
  portalModality: "web-portal" | "rest",
): AgentToolAction[] | undefined {
  switch (scenarioId) {
    case "01":
      if (seed === "realistic") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients?last_name=Chen&first_name=Sarah" },
          {
            service: "crm",
            method: "POST",
            path: "/v1/leads",
            body: {
              client_id: "CLI-001",
              first_name: "Sarah",
              last_name: "Chen",
              email: "sarah.chen@email.com",
              phone: "310-555-0101",
              source: "phone",
              status: "new",
              assigned_producer: "PROD-01",
            },
          },
          {
            service: "crm",
            method: "POST",
            path: "/v1/campaigns/camp_new_client_welcome/enroll",
            body: { client_id: "CLI-001", trigger_reason: "Existing client auto inquiry" },
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
              subject: "Welcome Back to Evergreen Insurance",
              body: "Hi Sarah, we linked your auto insurance inquiry to your existing profile (CLI-001) and scheduled a producer follow-up.",
            },
          },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Follow up on Sarah Chen auto quote",
              description: "Complete personal auto quote review for CLI-001",
              related_client_id: "CLI-001",
              priority: "medium",
              due_date: "2026-11-05",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients?last_name=Johnson" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/clients",
          body: {
            first_name: "Marcus",
            last_name: "Johnson",
            email: "marcus.johnson@email.com",
            phone: "512-555-0142",
            address: { street: "410 Congress Ave", city: "Austin", state: "TX", zip: "78701" },
          },
        },
        {
          service: "crm",
          method: "POST",
          path: "/v1/leads",
          body: {
            client_id: "CLI-023",
            first_name: "Marcus",
            last_name: "Johnson",
            email: "marcus.johnson@email.com",
            phone: "512-555-0142",
            source: "phone",
            status: "new",
            assigned_producer: "PROD-01",
          },
        },
        {
          service: "crm",
          method: "POST",
          path: "/v1/campaigns/camp_new_client_welcome/enroll",
          body: { client_id: "CLI-023", trigger_reason: "New auto insurance prospect intake" },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-023",
            to: "marcus.johnson@email.com",
            channel: "email",
            subject: "Welcome to Evergreen Insurance",
            body: "Hi Marcus, we have received your auto insurance intake and scheduled a producer follow-up.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Follow up on Marcus Johnson auto quote",
            description: "Complete personal auto quote review for CLI-023",
            related_client_id: "CLI-023",
            priority: "medium",
            due_date: "2026-11-05",
          },
        },
      ];

    case "02":
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-006" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-006/policies" },
        { service: "rater", method: "GET", path: "/v1/carriers/appetite?state=IL&policy_type=personal_auto" },
        {
          service: "rater",
          method: "POST",
          path: "/v1/quotes/request",
          body: {
            client_id: "CLI-006",
            policy_type: "personal_auto",
            effective_date: "2026-11-01",
            client: {
              first_name: "Marcus",
              last_name: "Williams",
              address: { street: "742 Evergreen Ter", city: "Chicago", state: "IL", zip: "60611" },
            },
            drivers: [{ first_name: "Marcus", last_name: "Williams", dob: "1985-04-12" }],
            vehicles: [{ year: 2023, make: "Toyota", model: "Camry", vin: "4T1C11AK5PU123456" }],
            requested_coverages: [
              { coverage_type: "bodily_injury", per_person_limit: 100000, per_accident_limit: 300000 },
              { coverage_type: "property_damage", per_accident_limit: 100000 },
            ],
          },
        },
        { service: "rater", method: "GET", path: "/v1/quotes/QR-006/results" },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-006",
            to: "marcus.williams@email.com",
            channel: "email",
            subject: "Multi-Carrier Auto Quote Comparison",
            body: "Your current Summit Fire (SMIT) renewal is $1,560/yr (up 21% from $1,290/yr). Here is your normalized 100/300/100 liability limit and $500 collision deductible comparison: SafeHarbor ($1,210/yr), National Shield ($1,245/yr), and Coastal Star ($1,290/yr).",
          },
        },
      ];

    case "03":
      if (seed === "realistic") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-003" },
          { service: "rater", method: "GET", path: "/v1/quotes/QR-001/results" },
          { service: "ecm", method: "GET", path: "/v1/documents?client_id=CLI-003&limit=50" },
          {
            service: "ecm",
            method: "POST",
            path: "/v1/envelopes/create",
            body: {
              client_id: "CLI-003",
              document_ids: ["DOC-011"],
              signers: [{ name: "Maria Rodriguez", email: "maria.rodriguez@email.com", role: "policyholder" }],
              message: "Please sign your auto application (DOC-011) before we can bind your National Shield quote.",
            },
          },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Follow up on pending signature DOC-011 for CLI-003 before binding",
              description: "Wait for Maria Rodriguez (CLI-003) to sign DOC-011 before binding QT-001-NTNW",
              related_client_id: "CLI-003",
              priority: "high",
              due_date: "2026-10-25",
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
              subject: "Signature Required on Application (DOC-011) Before Binding",
              body: "We verified your accepted National Shield quote ($1,010/yr), but DOC-011 is still pending_signature. We sent an e-signature envelope and will bind once signed.",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-003" },
        { service: "rater", method: "GET", path: "/v1/quotes/QR-001/results" },
        { service: "ecm", method: "GET", path: "/v1/documents?client_id=CLI-003" },
        {
          service: "ecm",
          method: "POST",
          path: "/v1/envelopes/create",
          body: {
            client_id: "CLI-003",
            document_ids: ["DOC-009"],
            signers: [{ name: "Maria Rodriguez", email: "maria.rodriguez@email.com", role: "policyholder" }],
            message: "Please sign your ACORD 90 application before binding.",
          },
        },
        {
          service: "rater",
          method: "POST",
          path: "/v1/quotes/QT-001-NTNW/bind",
          body: {
            payment_method: "eft",
            producer_id: "PROD-001",
            insured_signature_collected: true,
            insured_signature_date: "2026-10-14",
          },
        },
        { service: "ecm", method: "GET", path: "/v1/documents/acord/90?policy_id=POL-PA-2025-002103" },
        { service: "ams", method: "GET", path: "/v1/accounting/commissions?policy_id=POL-PA-2025-002103" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Verify bound policy documents for CLI-003",
            related_client_id: "CLI-003",
            priority: "medium",
            due_date: "2026-10-25",
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
            subject: "Policy Bound Confirmation: National Shield",
            body: "Your personal auto policy with National Shield ($1,010/yr) has been bound following e-signature completion.",
          },
        },
      ];

    case "04":
      if (seed === "clean") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients?limit=50" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-002/policies" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-025/policies" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Client duplicate audit complete: no duplicate records found",
              related_client_id: "CLI-001",
              priority: "low",
              due_date: "2026-10-28",
            },
          },
        ];
      }
      if (seed === "single-pair") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-025" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-031" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-025/policies" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-031/policies" },
          {
            service: "ams",
            method: "POST",
            path: "/v1/clients/CLI-025/merge",
            body: { source_client_id: "CLI-031", reason: "Duplicate record for Derek Hawkins" },
          },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Audit trail for merged duplicate client record CLI-031",
              related_client_id: "CLI-025",
              priority: "low",
              due_date: "2026-10-28",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients?limit=50" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-001" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-025" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-030/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-025/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-031/policies" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/clients/CLI-001/merge",
          body: { source_client_id: "CLI-030", reason: "Duplicate record for Sarah Chen" },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/clients/CLI-025/merge",
          body: { source_client_id: "CLI-031", reason: "Duplicate record for Derek Hawkins" },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Audit trail for merged duplicate client records CLI-030 and CLI-031",
            related_client_id: "CLI-001",
            priority: "low",
            due_date: "2026-10-28",
          },
        },
      ];

    case "05":
      if (seed === "clean") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-006" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-006/policies" },
          { service: "crm", method: "GET", path: "/v1/analytics/retention-risk?client_id=CLI-006" },
          {
            service: "rater",
            method: "POST",
            path: "/v1/quotes/request",
            body: {
              client_id: "CLI-006",
              policy_type: "personal_auto",
              effective_date: "2026-11-01",
              client: {
                first_name: "Marcus",
                last_name: "Williams",
                address: { street: "880 Biscayne Blvd", city: "Miami", state: "FL", zip: "33132" },
              },
              drivers: [{ first_name: "Marcus", last_name: "Williams", dob: "1988-07-19" }],
              vehicles: [{ year: 2021, make: "Mazda", model: "CX-5", vin: "JM3KFBCM8M0123456" }],
              requested_coverages: [
                { coverage_type: "bodily_injury", per_person_limit: 50000, per_accident_limit: 100000 },
                { coverage_type: "property_damage", per_accident_limit: 25000 },
              ],
            },
          },
          { service: "rater", method: "GET", path: "/v1/quotes/QR-005/results" },
          {
            service: "comm",
            modality: commModality,
            method: "POST",
            path: "/v1/messages/send",
            mcpToolName: "comm_send_message",
            body: {
              client_id: "CLI-006",
              to: "marcus.williams@email.com",
              channel: "email",
              subject: "Auto Renewal Re-Shop Options ($1,560 vs $1,290 Prior)",
              body: "Following your 21% renewal increase from $1,290 to $1,560 with Coastal Star, we compared quotes across Summit Fire ($1,640) and National Shield ($1,720); Coastal Star ($1,560) remains your lowest option.",
            },
          },
        ];
      }
      if (seed === "bundled") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-001" },
          { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
          {
            service: "rater",
            method: "POST",
            path: "/v1/quotes/request",
            body: {
              client_id: "CLI-001",
              policy_type: "personal_auto",
              effective_date: "2026-11-01",
              client: {
                first_name: "Sarah",
                last_name: "Chen",
                address: { street: "742 Maple Dr", city: "San Francisco", state: "CA", zip: "94102" },
              },
              drivers: [{ first_name: "Sarah", last_name: "Chen", dob: "1985-06-15" }],
              vehicles: [{ year: 2022, make: "Honda", model: "CR-V", vin: "2HKRW2H54NH123456" }],
              requested_coverages: [
                { coverage_type: "bodily_injury", per_person_limit: 100000, per_accident_limit: 300000 },
                { coverage_type: "property_damage", per_accident_limit: 100000 },
              ],
            },
          },
          { service: "rater", method: "GET", path: "/v1/quotes/QR-001/results" },
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
              subject: "Bundled Auto & Homeowners Renewal Comparison",
              body: "While standalone auto quotes exist, moving your $1,450 auto policy away from Summit would forfeit the multi-policy bundle discount on your $1,850 homeowners policy, increasing net household cost.",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-019" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-019/policies" },
        { service: "crm", method: "GET", path: "/v1/analytics/retention-risk?client_id=CLI-019" },
        { service: "rater", method: "GET", path: "/v1/carriers/appetite?state=CA&policy_type=personal_auto" },
        {
          service: "rater",
          method: "POST",
          path: "/v1/quotes/request",
          body: {
            client_id: "CLI-019",
            policy_type: "personal_auto",
            effective_date: "2026-11-15",
            client: {
              first_name: "Tyler",
              last_name: "Morrison",
              address: { street: "100 Main St", city: "Los Angeles", state: "CA", zip: "90012" },
            },
            drivers: [{ first_name: "Tyler", last_name: "Morrison", dob: "1995-08-20" }],
            vehicles: [{ year: 2022, make: "Honda", model: "Accord", vin: "1HGCV1F14NA123456" }],
            requested_coverages: [
              { coverage_type: "bodily_injury", per_person_limit: 100000, per_accident_limit: 300000 },
              { coverage_type: "property_damage", per_accident_limit: 50000 },
            ],
          },
        },
        { service: "rater", method: "GET", path: "/v1/quotes/QR-002/results" },
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
            subject: "Renewal Re-Shop Comparison & Statutory Limit Notice",
            body: "Compared against your $2,850 renewal following 2 at-fault accidents (where SMIT and ERIE declined to quote), we maintained your compliant liability limits across Coastal Star ($2,780), Liberty Crest ($3,100), and SafeHarbor ($3,350). Accident surcharges typically age off in 12 to 24 months.",
          },
        },
      ];

    case "06":
      if (seed === "clean") {
        return [
          { service: "ams", method: "GET", path: "/v1/clients/CLI-001/policies" },
          {
            service: "rater",
            method: "POST",
            path: "/v1/quotes/request",
            body: {
              client_id: "CLI-001",
              policy_type: "umbrella",
              effective_date: "2026-11-01",
              client: {
                first_name: "Sarah",
                last_name: "Chen",
                address: { street: "742 Maple Dr", city: "San Francisco", state: "CA", zip: "94102" },
              },
              requested_coverages: [{ coverage_type: "umbrella", per_occurrence_limit: 2000000 }],
            },
          },
          { service: "rater", method: "GET", path: "/v1/quotes/QR-001/results" },
          {
            service: "crm",
            method: "POST",
            path: "/v1/campaigns/camp_life_pivot_2026/enroll",
            body: { client_id: "CLI-001", trigger_reason: "Umbrella cross-sell gap identified on portfolio review" },
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
              subject: "Umbrella Coverage Recommendation for Your Portfolio",
              body: "Based on your active personal auto and homeowners policies, we prepared an umbrella quote comparison and scheduled a licensed producer follow-up.",
            },
          },
          {
            service: "ams",
            method: "POST",
            path: "/v1/tasks",
            body: {
              title: "Follow up with Sarah Chen (CLI-001) on umbrella cross-sell quote",
              description: "Review umbrella coverage options with CLI-001",
              related_client_id: "CLI-001",
              priority: "medium",
              due_date: "2026-10-26",
            },
          },
        ];
      }
      return [
        { service: "ams", method: "GET", path: "/v1/clients?last_name=Thompson" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-004/policies" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-005/policies" },
        { service: "crm", method: "GET", path: "/v1/leads?client_id=CLI-004" },
        {
          service: "rater",
          method: "POST",
          path: "/v1/quotes/request",
          body: {
            client_id: "CLI-004",
            policy_type: "umbrella",
            effective_date: "2026-11-01",
            client: {
              first_name: "David",
              last_name: "Thompson",
              address: { street: "450 Oak Ln", city: "Chicago", state: "IL", zip: "60614" },
            },
            requested_coverages: [{ coverage_type: "umbrella", per_occurrence_limit: 2000000 }],
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-004",
            reason: "coverage_adequacy",
            summary: "Household umbrella and flood gap analysis requires licensed producer coverage recommendation.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Document household coverage gaps for David & Linda Thompson (CLI-004 / CLI-005)",
            related_client_id: "CLI-004",
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
            client_id: "CLI-004",
            to: "david.thompson@email.com",
            channel: "email",
            subject: "Household Multi-Policy & Umbrella Review",
            body: "We identified a multi-policy bundling opportunity for your household and escalated a $2M umbrella review to a licensed producer.",
          },
        },
      ];

    case "07": {
      const actions: AgentToolAction[] = [
        { service: "ams", method: "GET", path: "/v1/clients/CLI-002" },
        { service: "ams", method: "GET", path: "/v1/clients/CLI-002/policies" },
        {
          service: "claims",
          method: "POST",
          path: "/v1/claims",
          body: {
            policy_id: "POL-HO-2025-001010",
            client_id: "CLI-002",
            loss_date: "2026-10-13",
            claim_type: "property_damage",
            loss_description: "Neighbor tree fell on fence during storm",
          },
        },
        {
          service: "claims",
          method: "POST",
          path: "/v1/claims/{created_claim_id}/assign",
          body: { adjuster_id: "ADJ-002", notes: "Assign property damage adjuster" },
        },
        { service: "ecm", method: "GET", path: "/v1/documents/acord/35?claim_id={created_claim_id}" },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-002",
            policy_id: "POL-HO-2025-001010",
            reason: "claims_specialist",
            summary: "FNOL property damage claim filed; routing to licensed claims specialist per E&O Trigger #7.",
          },
        },
      ];
      if (seed === "coverage-question") {
        actions.push({
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-002",
            policy_id: "POL-HO-2025-001010",
            reason: "coverage_adequacy",
            summary:
              "Client asked whether storm fence damage is covered under homeowners; routing coverage determination to licensed producer per E&O Trigger #1.",
          },
        });
      }
      actions.push(
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Follow up on adjuster inspection for {created_claim_id}",
            related_client_id: "CLI-002",
            priority: "high",
            due_date: "2026-10-22",
          },
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
            subject: "FNOL Claim Filed: Reference Number & Next Steps",
            body: "We have registered your property damage claim under POL-HO-2025-001010, assigned an adjuster, and routed the claim to a licensed specialist.",
          },
        },
      );
      return actions;
    }

    default:
      return undefined;
  }
}

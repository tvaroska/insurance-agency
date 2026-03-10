/**
 * Known seed data IDs for E2E tests.
 * These match data loaded by each service from data/seed/*.json at startup.
 */

// ── AMS Clients ──
export const CLIENTS = {
  SARAH_CHEN: {
    id: "CLI-001",
    first_name: "Sarah",
    last_name: "Chen",
    email: "sarah.chen@email.com",
    state: "CA",
  },
  JAMES_CHEN: {
    id: "CLI-002",
    first_name: "James",
    last_name: "Chen",
    email: "james.chen@email.com",
    state: "CA",
  },
  MARIA_RODRIGUEZ: {
    id: "CLI-003",
    first_name: "Maria",
    last_name: "Rodriguez",
    email: "maria.rodriguez@email.com",
    state: "TX",
  },
  DAVID_THOMPSON: {
    id: "CLI-004",
    first_name: "David",
    last_name: "Thompson",
    email: "d.thompson@thompsonllc.com",
    state: "IL",
  },
} as const;

// ── AMS Policies ──
export const POLICIES = {
  SARAH_AUTO: "POL-PA-2025-001847", // CLI-001, SMIT, personal_auto
  SARAH_HOME: "POL-HO-2025-000312", // CLI-001, SMIT, homeowners
  JAMES_AUTO: "POL-PA-2025-001848", // CLI-002, SMIT, personal_auto
  MARIA_AUTO: "POL-PA-2025-002103", // CLI-003, CSTL, personal_auto
  DAVID_BOP: "POL-BO-2025-000045", // CLI-004, SMIT, bop
} as const;

// ── Rater Carriers ──
export const CARRIERS = {
  CSTL: "CSTL",
  SMIT: "SMIT",
  HRTF: "HRTF",
  ERIE: "ERIE",
  NTNW: "NTNW",
  SAFECO: "SAFECO",
  LIBT: "LIBT",
} as const;

// ── Rater Quotes ──
export const QUOTE_REQUESTS = {
  QR_001: "QR-001", // CLI-003, personal_auto, completed, 4 carrier quotes
} as const;

export const QUOTES = {
  QT_001_CSTL: "QT-001-CSTL", // Coastal Star quote for QR-001
  QT_001_SMIT: "QT-001-SMIT", // Summit quote for QR-001
  QT_005_CSTL: "QT-005-CSTL", // Coastal Star bound quote
} as const;

// ── CRM Leads ──
export const LEADS = {
  SARAH_CHEN: "lead_8f3a12c4", // CLI-001, qualified, score 92
} as const;

// ── CRM Campaigns ──
export const CAMPAIGNS = {
  LIFE_PIVOT: "camp_life_pivot_2026",
  RENEWAL_Q1: "camp_renewal_q1",
  NEW_CLIENT_WELCOME: "camp_new_client_welcome",
} as const;

// ── ECM Documents ──
export const DOCUMENTS = {
  SARAH_AUTO_APP: "DOC-001", // CLI-001, signed_application
  SARAH_AUTO_DEC: "DOC-002", // CLI-001, dec_page
} as const;

// ── ECM Marketing Assets ──
export const ASSETS = {
  PERSONAL_WELCOME_KIT: "AST-001",
  COMPARISON_TEMPLATE: "AST-005",
} as const;

// ── Carrier Portal Quotes ──
export const CARRIER_QUOTES = {
  SMIT_QT_001: "QT-001-SMIT", // Summit quote, pending_review
  CSTL_QT_001: "QT-001-CSTL", // Coastal Star quote, assessed
} as const;

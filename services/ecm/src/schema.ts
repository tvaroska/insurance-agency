import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ── Documents ────────────────────────────────────────────────────────

export const documents = sqliteTable("documents", {
  document_id: text("document_id").primaryKey(),
  client_id: text("client_id").notNull(),
  document_type: text("document_type").notNull(), // signed_application, id_verification, coi, dec_page, endorsement, cancellation_notice, welcome_kit
  filename: text("filename").notNull(),
  mime_type: text("mime_type").notNull(),
  file_size_bytes: integer("file_size_bytes").notNull(),
  status: text("status").notNull().default("uploaded"), // uploaded, pending_signature, signed, expired, generated
  upload_date: text("upload_date").notNull(),
  signer_name: text("signer_name"),
  signer_email: text("signer_email"),
  signed_date: text("signed_date"),
  expiration_date: text("expiration_date"),
  tags: text("tags").notNull().default("[]"), // JSON array
});

// ── Envelopes ────────────────────────────────────────────────────────

export const envelopes = sqliteTable("envelopes", {
  envelope_id: text("envelope_id").primaryKey(),
  client_id: text("client_id").notNull(),
  document_ids: text("document_ids").notNull().default("[]"), // JSON array
  signers: text("signers").notNull().default("[]"), // JSON array of {name, email, role, status, signed_at}
  status: text("status").notNull().default("created"), // created, sent, viewed, signed, completed, declined, expired
  message: text("message"),
  redirect_url: text("redirect_url"),
  created_at: text("created_at").notNull(),
  completed_at: text("completed_at"),
  expiration_date: text("expiration_date").notNull(),
});

// ── Marketing Assets ─────────────────────────────────────────────────

export const marketingAssets = sqliteTable("marketing_assets", {
  asset_id: text("asset_id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(), // welcome_kit, flyer, comparison_template, social_media
  mime_type: text("mime_type").notNull(),
  url: text("url").notNull(),
  version: text("version").notNull(),
  published_date: text("published_date").notNull(),
});

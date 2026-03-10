import { createMiddleware } from "hono/factory";
import type { CorrelationVariables } from "./correlation";

// ---------------------------------------------------------------------------
// PII masking functions
// ---------------------------------------------------------------------------

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const PHONE_RE = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function maskSsn(value: string): string {
  const digits = value.replace(/\D/g, "");
  return `***-**-${digits.slice(-4)}`;
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return `(***) ***-${digits.slice(-4)}`;
}

export function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "[REDACTED]";
  return `${local[0]}***@${domain}`;
}

export function maskDob(): string {
  return "[REDACTED]";
}

export function maskAccountNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  return `****${digits.slice(-4)}`;
}

export function maskDriverLicense(value: string): string {
  return `****${value.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Key-based PII field detection
// ---------------------------------------------------------------------------

const DOB_KEYS = new Set(["dob", "date_of_birth", "birth_date", "birthdate"]);
const SSN_KEYS = new Set(["ssn", "social_security", "social_security_number"]);
const DL_KEYS = new Set(["driver_license", "drivers_license", "dl_number"]);
const ACCOUNT_KEYS = new Set(["bank_account", "account_number", "bank_account_number"]);
const EMAIL_KEYS = new Set(["email", "email_address"]);
const PHONE_KEYS = new Set(["phone", "phone_number", "mobile", "cell", "telephone"]);

function maskByKey(key: string, value: unknown): unknown | undefined {
  if (typeof value !== "string") return undefined;
  const k = key.toLowerCase();
  if (DOB_KEYS.has(k)) return maskDob();
  if (SSN_KEYS.has(k)) return maskSsn(value);
  if (DL_KEYS.has(k)) return maskDriverLicense(value);
  if (ACCOUNT_KEYS.has(k)) return maskAccountNumber(value);
  if (EMAIL_KEYS.has(k)) return maskEmail(value);
  if (PHONE_KEYS.has(k)) return maskPhone(value);
  return undefined; // no key match
}

// ---------------------------------------------------------------------------
// Inline regex masking for string values
// ---------------------------------------------------------------------------

function maskStringInline(value: string): string {
  let result = value;
  result = result.replace(SSN_RE, (m) => maskSsn(m));
  result = result.replace(EMAIL_RE, (m) => maskEmail(m));
  result = result.replace(PHONE_RE, (m) => maskPhone(m));
  return result;
}

// ---------------------------------------------------------------------------
// Deep recursive PII masking
// ---------------------------------------------------------------------------

export function maskPii(input: unknown): unknown {
  if (input === null || input === undefined) return input;

  if (typeof input === "string") {
    return maskStringInline(input);
  }

  if (Array.isArray(input)) {
    return input.map((item) => maskPii(item));
  }

  if (typeof input === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const masked = maskByKey(key, value);
      if (masked !== undefined) {
        result[key] = masked;
      } else {
        result[key] = maskPii(value);
      }
    }
    return result;
  }

  return input;
}

// ---------------------------------------------------------------------------
// Log entry type
// ---------------------------------------------------------------------------

export type LogEntry = {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  correlation_id: string;
  query?: Record<string, string>;
  user_agent?: string;
};

// ---------------------------------------------------------------------------
// Request logger middleware
// ---------------------------------------------------------------------------

export const requestLogger = createMiddleware<{
  Variables: CorrelationVariables;
}>(async (c, next) => {
  const start = performance.now();

  await next();

  const duration = Math.round(performance.now() - start);
  const url = new URL(c.req.url);

  const queryRaw: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    queryRaw[k] = v;
  });
  const query =
    Object.keys(queryRaw).length > 0
      ? (maskPii(queryRaw) as Record<string, string>)
      : undefined;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    method: c.req.method,
    path: url.pathname,
    status: c.res.status,
    duration_ms: duration,
    correlation_id: c.get("correlationId") ?? "",
    ...(query && { query }),
    ...(c.req.header("user-agent") && {
      user_agent: c.req.header("user-agent"),
    }),
  };

  console.log(JSON.stringify(entry));
});

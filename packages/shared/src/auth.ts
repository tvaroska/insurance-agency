import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { createErrorResponse } from "./errors";

// ── Types ──

export interface JwtPayload {
  sub: string;
  scope: string;
  exp: number;
  iat: number;
  [key: string]: unknown;
}

export interface DevTokenOptions {
  sub?: string;
  scopes?: string[];
  expiresIn?: number;
  secret?: string;
}

export type AuthVariables = {
  jwtPayload: JwtPayload;
};

// ── Internal JWT helpers ──

function base64urlEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function jsonToBase64url(obj: object): string {
  return base64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

async function getSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const header = jsonToBase64url({ alg: "HS256", typ: "JWT" });
  const body = jsonToBase64url(payload);
  const signingInput = `${header}.${body}`;
  const key = await getSigningKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64urlEncode(new Uint8Array(sig))}`;
}

async function verifyJwt(token: string, secret: string): Promise<JwtPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");

  const [header, payload, signature] = parts;
  const key = await getSigningKey(secret);
  const signingInput = `${header}.${payload}`;
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64urlDecode(signature),
    new TextEncoder().encode(signingInput),
  );
  if (!valid) throw new Error("Invalid signature");

  const decoded = JSON.parse(
    new TextDecoder().decode(base64urlDecode(payload)),
  ) as JwtPayload;

  if (typeof decoded.exp === "number" && decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }

  return decoded;
}

// ── Error helpers ──

function authError(message: string): HTTPException {
  return new HTTPException(401, {
    message,
    res: new Response(
      JSON.stringify(createErrorResponse("AUTH_ERROR", message)),
      { status: 401, headers: { "Content-Type": "application/json" } },
    ),
  });
}

function forbiddenError(message: string): HTTPException {
  return new HTTPException(403, {
    message,
    res: new Response(
      JSON.stringify(createErrorResponse("FORBIDDEN", message)),
      { status: 403, headers: { "Content-Type": "application/json" } },
    ),
  });
}

// ── Middleware ──

export const jwtAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw authError("Missing or malformed Authorization header.");
    }

    const token = authHeader.slice(7);
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET environment variable is not set.");
    }

    let payload: JwtPayload;
    try {
      payload = await verifyJwt(token, secret);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid token";
      throw authError(msg);
    }

    c.set("jwtPayload", payload);
    await next();
  },
);

export function requireScopes(...required: string[]) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const payload = c.get("jwtPayload");
    if (!payload) {
      throw authError("Authentication required.");
    }

    const granted = new Set((payload.scope ?? "").split(" ").filter(Boolean));
    const missing = required.filter((s) => !granted.has(s));

    if (missing.length > 0) {
      throw forbiddenError(`Missing required scope(s): ${missing.join(", ")}`);
    }

    await next();
  });
}

// ── Dev token generator ──

export async function generateDevToken(opts: DevTokenOptions = {}): Promise<string> {
  const secret = opts.secret ?? process.env.JWT_SECRET ?? "dev-secret";
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: opts.sub ?? "dev-user",
    scope: (opts.scopes ?? []).join(" "),
    iat: now,
    exp: now + (opts.expiresIn ?? 3600),
  };
  return signJwt(payload, secret);
}

// ── OAuth Client Credentials ──

const ALL_SCOPES = [
  "ams:clients:read", "ams:clients:write", "ams:policies:read",
  "ams:policies:endorsements", "ams:accounting:read",
  "ams:tasks:read", "ams:tasks:write",
  "rater:quotes:create", "rater:quotes:read", "rater:quotes:bind",
  "rater:carriers:read",
  "crm:leads:read", "crm:leads:write", "crm:campaigns:enroll", "crm:campaigns:read",
  "crm:analytics:read",
  "ecm:documents:read", "ecm:documents:write", "ecm:documents:upload",
  "ecm:envelopes:create", "ecm:assets:read", "ecm:acord:read",
  "comm:messages:read", "comm:messages:send", "comm:calls:read",
  "comm:webhooks:manage",
  "ams:escalations:read", "ams:escalations:write",
  "claims:read", "claims:write", "claims:assign", "claims:documents",
  "carrier:quotes:read", "carrier:quotes:write",
  "carrier:underwriting:write", "carrier:policies:read",
];

const READ_SCOPES = ALL_SCOPES.filter(
  (s) => s.endsWith(":read") || s === "claims:read",
);

const CSR_SCOPES = ALL_SCOPES.filter(
  (s) =>
    !s.endsWith(":endorsements") &&
    !s.includes("underwriting") &&
    !s.includes("webhooks"),
);

interface OAuthClient {
  secret: string;
  scopes: string[];
  sub: string;
}

const OAUTH_CLIENTS: Record<string, OAuthClient> = {
  "agent-full": { secret: "dev-secret", scopes: ALL_SCOPES, sub: "agent-full" },
  "agent-csr": { secret: "dev-secret", scopes: CSR_SCOPES, sub: "agent-csr" },
  "agent-readonly": { secret: "dev-secret", scopes: READ_SCOPES, sub: "agent-readonly" },
};

export function oauthTokenEndpoint(): Hono {
  const oauth = new Hono();

  oauth.post("/oauth/token", async (c) => {
    const contentType = c.req.header("content-type") ?? "";

    let grantType: string | undefined;
    let clientId: string | undefined;
    let clientSecret: string | undefined;
    let requestedScope: string | undefined;

    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const body = await c.req.parseBody();
      grantType = body.grant_type as string | undefined;
      clientId = body.client_id as string | undefined;
      clientSecret = body.client_secret as string | undefined;
      requestedScope = body.scope as string | undefined;
    } else {
      const body = await c.req.json().catch(() => ({}));
      grantType = body.grant_type;
      clientId = body.client_id;
      clientSecret = body.client_secret;
      requestedScope = body.scope;
    }

    if (grantType !== "client_credentials") {
      return c.json({ error: "unsupported_grant_type", error_description: "Only client_credentials grant type is supported" }, 400);
    }

    if (!clientId || !clientSecret) {
      return c.json({ error: "invalid_request", error_description: "client_id and client_secret are required" }, 400);
    }

    const client = OAUTH_CLIENTS[clientId];
    if (!client || client.secret !== clientSecret) {
      return c.json({ error: "invalid_client", error_description: "Invalid client credentials" }, 401);
    }

    let scopes = client.scopes;
    if (requestedScope) {
      const requested = requestedScope.split(" ").filter(Boolean);
      const invalid = requested.filter((s) => !client.scopes.includes(s));
      if (invalid.length > 0) {
        return c.json({ error: "invalid_scope", error_description: `Invalid scope(s): ${invalid.join(", ")}` }, 400);
      }
      scopes = requested;
    }

    const secret = process.env.JWT_SECRET ?? "dev-secret";
    const token = await generateDevToken({
      sub: client.sub,
      scopes,
      secret,
    });

    return c.json({
      access_token: token,
      token_type: "Bearer",
      expires_in: 3600,
      scope: scopes.join(" "),
    });
  });

  return oauth;
}

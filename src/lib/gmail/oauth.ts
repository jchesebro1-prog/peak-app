import crypto from "node:crypto";
import {
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  GMAIL_SCOPES,
  callbackUrl,
  googleClientId,
  googleClientSecret,
} from "./config";

/**
 * OAuth2 authorization-code flow for connecting a Gmail mailbox. This is a
 * SEPARATE consent from Auth.js sign-in (which only asks for openid/email):
 * connecting a mailbox needs Gmail scopes and an offline refresh token, so we
 * run our own /api/gmail/connect → Google → /api/gmail/callback round-trip and
 * reuse only the Google OAuth *client* (AUTH_GOOGLE_ID/SECRET).
 */

export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string; // only returned on the first consent (offline access)
  expiresAt: number; // epoch-ms
  scope?: string;
};

/* ---- signed state (CSRF + carries the mailbox being connected) ---- */

export type ConnectState = {
  mailboxKey: string;
  userId: string; // who initiated the connect
  n: string; // nonce
};

function stateSecret(): Buffer {
  return crypto
    .createHash("sha256")
    .update((process.env.AUTH_SECRET || "") + ":gmail-state")
    .digest();
}

export function signState(payload: Omit<ConnectState, "n">): string {
  const body: ConnectState = { ...payload, n: crypto.randomBytes(8).toString("hex") };
  const json = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", stateSecret())
    .update(json)
    .digest("base64url");
  return json + "." + sig;
}

export function verifyState(state: string): ConnectState | null {
  const [json, sig] = (state || "").split(".");
  if (!json || !sig) return null;
  const expected = crypto
    .createHmac("sha256", stateSecret())
    .update(json)
    .digest("base64url");
  // constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(json, "base64url").toString("utf8")) as ConnectState;
  } catch {
    return null;
  }
}

/* ---- flow ---- */

/** Build the Google consent URL. `login_hint` pre-selects the mailbox account. */
export function authorizeUrl(state: string, loginHint?: string): string {
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: callbackUrl(),
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline", // → refresh token
    prompt: "consent", // force refresh-token issuance every time
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) params.set("login_hint", loginHint);
  return GOOGLE_AUTH_URL + "?" + params.toString();
}

/** Exchange the authorization code for tokens. */
export async function exchangeCode(code: string): Promise<OAuthTokens> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      redirect_uri: callbackUrl(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error("Token exchange failed: " + res.status + " " + (await res.text()));
  }
  const j = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Date.now() + (j.expires_in || 3600) * 1000,
    scope: j.scope,
  };
}

/** Trade a refresh token for a fresh access token. */
export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error("Token refresh failed: " + res.status + " " + (await res.text()));
  }
  const j = (await res.json()) as { access_token: string; expires_in: number; scope?: string };
  return {
    accessToken: j.access_token,
    refreshToken, // unchanged on refresh
    expiresAt: Date.now() + (j.expires_in || 3600) * 1000,
    scope: j.scope,
  };
}

/** The email address that just authorized — this becomes the mailbox address. */
export async function fetchAccountEmail(accessToken: string): Promise<string> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (!res.ok) {
    throw new Error("userinfo failed: " + res.status + " " + (await res.text()));
  }
  const j = (await res.json()) as { email?: string };
  return (j.email || "").toLowerCase();
}

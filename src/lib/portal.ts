import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getBlob, setBlob } from "@/db/doc-store";
import { encryptToken, decryptToken } from "@/lib/gmail/crypto";

/**
 * Customer portal access (IDEAS #47 phase 1) — per-PERSON magic-link grants,
 * exactly Jeff's design call: every individual contact gets their own login,
 * no passwords and no Google requirement. A grant is a long random token
 * tied to one customer + one person; opening /portal/access?t=<token> sets
 * an httpOnly cookie and every portal query is HARD-SCOPED to the grant's
 * customerId (the portal never reuses team endpoints, which trust every
 * signed-in user with everything).
 *
 * Grants live in the `portal_grants` blob as a keyed map — small volume
 * (a handful of contacts per customer), admin-managed from the customer
 * record, revocable at any time. Email delivery of the link can ride the
 * Gmail integration later; until then the office copies the link and sends
 * it from their own mail (same ceremony as the public lead-intake URL).
 *
 * Department scoping (Jeff's person → department → cross-link model) is
 * carried structurally as `dept` on the grant but v1 shows the customer
 * org's whole published world — real department mapping needs Jeff's org
 * charts (MASTER-QUESTIONS).
 */

export type PortalGrant = {
  id: string;
  customerId: string;
  name: string;
  email: string;
  dept?: string;
  /** Magic-link token, AES-256-GCM encrypted at rest (see gmail/crypto). A
   *  leaked DB/backup blob no longer hands over usable portal sessions. */
  tokenEnc: string;
  /** Legacy plaintext token from before at-rest encryption — read-only
   *  fallback so links created earlier keep working. */
  token?: string;
  createdAt: number;
  createdBy: string;
  /** Hard expiry — the grant stops working after this even if never revoked. */
  expiresAt: number;
  revokedAt?: number | null;
  lastSeenAt?: number | null;
};

export type PortalSession = {
  grantId: string;
  customerId: string;
  name: string;
  email: string;
};

const BLOB_ID = "portal_grants";
export const PORTAL_COOKIE = "pk_portal";
/** Portal login lifetime: the grant hard-expires and the cookie lives this
 *  long. Was an unbounded grant behind a 180-day cookie; 90 days halves the
 *  replay window while staying generous for a customer. Tune here. */
export const PORTAL_TTL_DAYS = 90;
const GRANT_TTL_MS = PORTAL_TTL_DAYS * 24 * 60 * 60 * 1000;
/** Refresh lastSeenAt at most this often (avoid a write per request). */
const SEEN_REFRESH_MS = 10 * 60 * 1000;

type GrantMap = Record<string, PortalGrant>;

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function allGrants(): Promise<GrantMap> {
  return getBlob<GrantMap>(BLOB_ID, {});
}

/** Active + revoked grants for one customer, newest first. */
export async function grantsFor(customerId: string): Promise<PortalGrant[]> {
  const map = await allGrants();
  return Object.values(map)
    .filter((g) => g.customerId === customerId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function createGrant(input: {
  customerId: string;
  name: string;
  email: string;
  dept?: string;
  createdBy: string;
}): Promise<PortalGrant> {
  const now = Date.now();
  const grant: PortalGrant = {
    id: "PG-" + randomToken().slice(0, 10),
    customerId: input.customerId,
    name: input.name.trim(),
    email: input.email.trim(),
    ...(input.dept ? { dept: input.dept.trim() } : {}),
    tokenEnc: encryptToken(randomToken()),
    createdAt: now,
    createdBy: input.createdBy,
    expiresAt: now + GRANT_TTL_MS,
    revokedAt: null,
    lastSeenAt: null,
  };
  await setBlob(BLOB_ID, { [grant.id]: grant });
  return grant;
}

export async function revokeGrant(id: string): Promise<void> {
  const map = await allGrants();
  const g = map[id];
  if (!g) return;
  await setBlob(BLOB_ID, { [id]: { ...g, revokedAt: Date.now() } });
}

/** The raw magic-link token for a grant — decrypted from tokenEnc (or the
 *  legacy plaintext field for pre-encryption grants). */
function rawToken(g: Pick<PortalGrant, "tokenEnc" | "token">): string {
  if (g.tokenEnc) {
    try {
      return decryptToken(g.tokenEnc);
    } catch {
      return "";
    }
  }
  return g.token || "";
}

/** The magic-link path for a grant (prefix with the site origin to share). */
export function grantPath(g: Pick<PortalGrant, "tokenEnc" | "token">): string {
  return "/portal/access?t=" + rawToken(g);
}

/** Resolve a raw token to its active grant (null when unknown/revoked/expired).
 *  Constant-time comparison so a stored token can't be recovered by timing. */
export async function grantByToken(token: string): Promise<PortalGrant | null> {
  if (!token || token.length < 32) return null;
  const map = await allGrants();
  const now = Date.now();
  const wanted = Buffer.from(token);
  for (const g of Object.values(map)) {
    if (g.revokedAt) continue;
    if (g.expiresAt && now > g.expiresAt) continue;
    const have = Buffer.from(rawToken(g));
    if (have.length === wanted.length && timingSafeEqual(have, wanted)) {
      return g;
    }
  }
  return null;
}

/**
 * The portal session for the current request — resolved from the cookie,
 * never from any team login. Every portal data access derives its
 * customerId from HERE and nowhere else.
 */
export async function portalSession(): Promise<PortalSession | null> {
  const jar = await cookies();
  const token = jar.get(PORTAL_COOKIE)?.value || "";
  const g = await grantByToken(token);
  if (!g) return null;
  // touch lastSeenAt occasionally (fire-and-forget semantics)
  if (!g.lastSeenAt || Date.now() - g.lastSeenAt > SEEN_REFRESH_MS) {
    await setBlob(BLOB_ID, { [g.id]: { ...g, lastSeenAt: Date.now() } });
  }
  return { grantId: g.id, customerId: g.customerId, name: g.name, email: g.email };
}

/**
 * #368 — dealer API connections (ETC first). Server only.
 *
 * One blob, `dealer_connections`, keyed by provider. The ETC API secret is
 * stored encrypted (AES-256-GCM, `encryptWith` keyed on AUTH_SECRET — the
 * `assist_secrets` pattern, D881) in this blob's own `blobs` row, never in
 * `app_settings`, so it never rides along with the settings object pages hand
 * to client components.
 *
 * `etcSecret()` is the ONE function that decrypts, and only the ETC client
 * (`etc/client.ts`) calls it. `etcStatus()` is the safe view the drawer and
 * pages get: the last four characters, never the key. A Vercel preview never
 * uses the stored key (previews share the production DB);
 * `ETC_SYNC_DISABLED=true` turns off Pull and the daily rider.
 */
import { getBlob, updateBlob } from "@/db/doc-store";
import { decryptWith, encryptWith } from "@/lib/gmail/crypto";

export const DEALER_CONNECTIONS_BLOB = "dealer_connections";

type Env = Record<string, string | undefined>;

export type EtcRunCounts = {
  created: number;
  updated: number;
  unchanged: number;
  demo: number;
  demoUnmatched: number;
  skipped: number;
};

export type EtcRunSummary = EtcRunCounts & {
  at: number;
  kind: "import" | "daily";
  ok: boolean;
  /** Rows the run applied. */
  rows: number;
  /** The run stopped on its time budget; the next run finishes it. */
  pending: boolean;
  error: string | null;
};

export type EtcBaseline = { date: string; at: number };

export type EtcCursor = {
  /** `pulledAt` of the snapshot this cursor walks — a new pull resets it. */
  snapshotAt: number;
  next: number;
  counts: EtcRunCounts;
};

export type EtcConnection = {
  keyEnc: string | null;
  last4: string | null;
  savedAt: number | null;
  savedBy: string | null;
  accountId: string | null;
  accountName: string | null;
  baseline: EtcBaseline | null;
  lastRun: EtcRunSummary | null;
  cursor: EtcCursor | null;
  /** Lease: an apply batch is running until this epoch ms. */
  applyingUntil: number;
};

export const EMPTY_ETC: EtcConnection = {
  keyEnc: null,
  last4: null,
  savedAt: null,
  savedBy: null,
  accountId: null,
  accountName: null,
  baseline: null,
  lastRun: null,
  cursor: null,
  applyingUntil: 0,
};

export type ConnDeps = {
  /** Encryption secret; default process.env.AUTH_SECRET. */
  authSecret?: string;
  /** Default process.env. */
  env?: Env;
  now?: number;
};

const MAX_KEY = 512;

function authSecretOf(deps: ConnDeps): string {
  return deps.authSecret ?? process.env.AUTH_SECRET ?? "";
}

/** A Vercel preview deploy never uses the stored key (previews share the production DB). */
export function etcPreviewBlocked(env: Env = process.env): boolean {
  return (env.VERCEL_ENV || "").trim() === "preview";
}

/** Kill switch for Pull and the daily rider. */
export function etcSyncDisabled(env: Env = process.env): boolean {
  return (env.ETC_SYNC_DISABLED || "").trim() === "true";
}

/** Trimmed key, or null when it can't be one (empty, too long, whitespace inside). */
export function cleanEtcKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const k = raw.trim();
  if (!k || k.length > MAX_KEY || /\s/.test(k)) return null;
  return k;
}

function clean(raw: unknown): EtcConnection {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<EtcConnection>;
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const b = r.baseline;
  const c = r.cursor;
  return {
    keyEnc: s(r.keyEnc),
    last4: s(r.last4),
    savedAt: n(r.savedAt),
    savedBy: s(r.savedBy),
    accountId: s(r.accountId),
    accountName: s(r.accountName),
    baseline: b && typeof b === "object" && typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? { date: b.date, at: n(b.at) ?? 0 } : null,
    lastRun: r.lastRun && typeof r.lastRun === "object" ? (r.lastRun as EtcRunSummary) : null,
    cursor: c && typeof c === "object" && typeof c.snapshotAt === "number" && typeof c.next === "number" ? (c as EtcCursor) : null,
    applyingUntil: n(r.applyingUntil) ?? 0,
  };
}

/** The stored ETC connection, ciphertext included. Server only — never hand it to a client. */
export async function readEtcConnection(): Promise<EtcConnection> {
  const blob = await getBlob<{ etc?: unknown }>(DEALER_CONNECTIONS_BLOB, {});
  return clean(blob.etc);
}

/**
 * Read-modify-write of the ETC entry under the blob's row lock. `fn` returns
 * the fields to change (merged over the current entry) or null for no write.
 * Returns the entry after the call.
 */
export async function updateEtcConnection(fn: (cur: EtcConnection) => Partial<EtcConnection> | null): Promise<EtcConnection> {
  let after: EtcConnection | null = null;
  const stored = await updateBlob(DEALER_CONNECTIONS_BLOB, (current) => {
    const cur = clean(current.etc);
    const patch = fn(cur);
    if (patch === null) {
      after = cur;
      return null;
    }
    after = { ...cur, ...patch };
    return { etc: after };
  });
  return after ?? clean(stored.etc);
}

/** Encrypt and store a key. Throws on an invalid key or a missing AUTH_SECRET — never with the key in the message. */
export async function saveEtcKey(plain: string, by: string, deps: ConnDeps = {}): Promise<{ last4: string }> {
  const key = cleanEtcKey(plain);
  if (!key) throw new Error("That doesn't look like an ETC API key.");
  const secret = authSecretOf(deps);
  if (!secret) throw new Error("AUTH_SECRET is required to store the ETC key.");
  const last4 = key.slice(-4);
  const keyEnc = encryptWith(key, secret);
  const now = deps.now ?? Date.now();
  // The picked account stays until Test connection shows the new key can't see it.
  await updateEtcConnection(() => ({ keyEnc, last4, savedAt: now, savedBy: (by || "").slice(0, 120) || null }));
  return { last4 };
}

/** Remove the key and everything tied to it (account, baseline, cursor). The last run stays for the record. */
export async function clearEtcKey(): Promise<void> {
  await updateEtcConnection(() => ({ keyEnc: null, last4: null, savedAt: null, savedBy: null, accountId: null, accountName: null, baseline: null, cursor: null }));
}

/** Pick the business account. A different account clears the baseline and cursor: its prices need a full pull. */
export async function setEtcAccount(id: string | null, name: string | null): Promise<EtcConnection> {
  return updateEtcConnection((cur) => {
    const changed = cur.accountId !== id;
    return {
      accountId: id,
      accountName: name,
      ...(changed ? { baseline: null, cursor: null } : {}),
    };
  });
}

/**
 * THE decrypt. Only the ETC client calls it. null when no key is stored, it
 * can't be decrypted (AUTH_SECRET changed?), or this is a Vercel preview.
 */
export async function etcSecret(deps: ConnDeps = {}): Promise<string | null> {
  if (etcPreviewBlocked(deps.env ?? process.env)) return null;
  const c = await readEtcConnection();
  if (!c.keyEnc) return null;
  const secret = authSecretOf(deps);
  if (!secret) return null;
  try {
    return cleanEtcKey(decryptWith(c.keyEnc, secret));
  } catch {
    return null;
  }
}

export type EtcStatus = {
  connected: boolean;
  last4: string | null;
  savedAt: number | null;
  savedBy: string | null;
  /** A key is stored but can't be decrypted. */
  unreadable: boolean;
  accountId: string | null;
  accountName: string | null;
  baseline: EtcBaseline | null;
  lastRun: EtcRunSummary | null;
  /** An import is part-way through (rows applied of total). */
  importing: { done: number; snapshotAt: number } | null;
  preview: boolean;
  disabled: boolean;
};

/** The safe view: never the key or its ciphertext. */
export async function etcStatus(deps: ConnDeps = {}): Promise<EtcStatus> {
  const env = deps.env ?? process.env;
  const c = await readEtcConnection();
  let unreadable = false;
  if (c.keyEnc) {
    const secret = authSecretOf(deps);
    try {
      unreadable = !secret || !cleanEtcKey(decryptWith(c.keyEnc, secret));
    } catch {
      unreadable = true;
    }
  }
  return {
    connected: !!c.keyEnc,
    last4: c.keyEnc ? c.last4 : null,
    savedAt: c.keyEnc ? c.savedAt : null,
    savedBy: c.keyEnc ? c.savedBy : null,
    unreadable,
    accountId: c.accountId,
    accountName: c.accountName,
    baseline: c.baseline,
    lastRun: c.lastRun,
    importing: c.cursor ? { done: c.cursor.next, snapshotAt: c.cursor.snapshotAt } : null,
    preview: etcPreviewBlocked(env),
    disabled: etcSyncDisabled(env),
  };
}

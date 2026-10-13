/**
 * Admin-entered Claude API key (#334 follow-up, D881). Server only.
 *
 * The key lives encrypted (AES-256-GCM, `encryptWith`, keyed on AUTH_SECRET)
 * in its own `blobs` row — not `app_settings` — so the ciphertext never rides
 * along with the settings object that pages hand to client components.
 *
 * Nothing here returns the key to a caller that could serialise it:
 * `assistKeyInfo` (the Settings card) carries only the last four characters;
 * `getAssistEnv` is the one place the plaintext leaves this module, as
 * `ANTHROPIC_API_KEY` in a server-side env object for the gate and provider.
 *
 * Precedence is the pure `effectiveAnthropicKey` (config.ts): the stored key
 * wins over the env var, a Vercel preview ignores the stored key unless
 * `ASSIST_ALLOW_PREVIEW_KEY=true`, and an unreadable stored key falls back to
 * the env var.
 */
import { getBlob, setBlob } from "@/db/doc-store";
import { decryptWith, encryptWith } from "@/lib/gmail/crypto";
import { cleanApiKey, effectiveAnthropicKey, storedKeyBlocked, type AssistKeyInfo, type KeySource } from "./config";
import type { Env } from "./types";

export const ASSIST_SECRETS_BLOB = "assist_secrets";

export type AssistSecretsBlob = {
  anthropicKeyEnc: string | null;
  last4: string | null;
  savedAt: number | null;
  savedBy: string | null;
};

const EMPTY: AssistSecretsBlob = { anthropicKeyEnc: null, last4: null, savedAt: null, savedBy: null };

export type KeyDeps = {
  /** Encryption secret; default process.env.AUTH_SECRET. */
  secret?: string;
  /** Base env for getAssistEnv / assistKeyInfo; default process.env. */
  env?: Env;
  now?: number;
  /** Skip the 30 s in-process cache (tests). */
  noCache?: boolean;
};

export type StoredKeyRead = {
  stored: string | null;
  storedUnreadable: boolean;
  last4: string | null;
  savedAt: number | null;
  savedBy: string | null;
};

const CACHE_MS = 30_000;
let cache: { secret: string; at: number; value: StoredKeyRead } | null = null;

function secretOf(deps: KeyDeps): string {
  return deps.secret ?? process.env.AUTH_SECRET ?? "";
}

/** Encrypt and store the key. Throws on an invalid key or a missing AUTH_SECRET — never with the key in the message. */
export async function saveAssistKey(plain: string, by: string, deps: KeyDeps = {}): Promise<{ last4: string }> {
  const key = cleanApiKey(plain);
  if (!key) throw new Error("That doesn't look like a Claude API key.");
  const secret = secretOf(deps);
  if (!secret) throw new Error("AUTH_SECRET is required to store the Assist key.");
  const last4 = key.slice(-4);
  const row: AssistSecretsBlob = {
    anthropicKeyEnc: encryptWith(key, secret),
    last4,
    savedAt: deps.now ?? Date.now(),
    savedBy: (by || "").slice(0, 120) || null,
  };
  await setBlob(ASSIST_SECRETS_BLOB, row);
  cache = null;
  return { last4 };
}

/** Remove the stored key (setBlob merges, so the fields are nulled). */
export async function clearAssistKey(): Promise<void> {
  await setBlob(ASSIST_SECRETS_BLOB, { ...EMPTY });
  cache = null;
}

/** Decrypt the stored key. Never throws: a DB error reads as "nothing stored". */
export async function readAssistKey(deps: KeyDeps = {}): Promise<StoredKeyRead> {
  const secret = secretOf(deps);
  const now = deps.now ?? Date.now();
  if (!deps.noCache && cache && cache.secret === secret && now - cache.at < CACHE_MS) return cache.value;
  let row: AssistSecretsBlob;
  try {
    row = await getBlob<AssistSecretsBlob>(ASSIST_SECRETS_BLOB, { ...EMPTY });
  } catch (e) {
    console.error("[assist] reading the stored Assist key failed — using the env var", e instanceof Error ? e.message : "");
    return { stored: null, storedUnreadable: false, last4: null, savedAt: null, savedBy: null };
  }
  const meta = {
    last4: typeof row.last4 === "string" ? row.last4 : null,
    savedAt: typeof row.savedAt === "number" ? row.savedAt : null,
    savedBy: typeof row.savedBy === "string" ? row.savedBy : null,
  };
  let value: StoredKeyRead;
  if (typeof row.anthropicKeyEnc !== "string" || !row.anthropicKeyEnc) {
    value = { stored: null, storedUnreadable: false, ...meta };
  } else {
    let plain: string | null = null;
    if (secret) {
      try {
        plain = cleanApiKey(decryptWith(row.anthropicKeyEnc, secret));
      } catch {
        plain = null;
      }
    }
    value = plain ? { stored: plain, storedUnreadable: false, ...meta } : { stored: null, storedUnreadable: true, ...meta };
  }
  if (!deps.noCache) cache = { secret, at: now, value };
  return value;
}

/**
 * The env the Assist gate and provider read: the base env with
 * ANTHROPIC_API_KEY replaced by the effective key (D881) and
 * ASSIST_KEY_SOURCE set. Server-side only — never pass it to a client.
 */
export async function getAssistEnv(deps: KeyDeps = {}): Promise<Env> {
  const base = deps.env ?? process.env;
  const r = await readAssistKey(deps);
  const eff = effectiveAnthropicKey({ stored: r.stored, storedUnreadable: r.storedUnreadable, env: base });
  return { ...base, ANTHROPIC_API_KEY: eff.key ?? "", ASSIST_KEY_SOURCE: eff.source };
}

/** For the Settings card: where the key comes from, never the key. */
export async function assistKeyInfo(deps: KeyDeps = {}): Promise<AssistKeyInfo> {
  const base = deps.env ?? process.env;
  const r = await readAssistKey(deps);
  const eff = effectiveAnthropicKey({ stored: r.stored, storedUnreadable: r.storedUnreadable, env: base });
  const hasStored = !!r.stored || r.storedUnreadable;
  const source: KeySource = eff.source;
  return {
    source,
    last4: hasStored ? r.last4 : null,
    savedAt: hasStored ? r.savedAt : null,
    savedBy: hasStored ? r.savedBy : null,
    unreadable: r.storedUnreadable,
    previewIgnored: !!r.stored && storedKeyBlocked(base),
  };
}

/** Test hook: forget the cached decrypt. */
export function resetAssistKeyCache(): void {
  cache = null;
}

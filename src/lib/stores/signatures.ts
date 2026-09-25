/**
 * #127 — per-user plain-text email signatures. No DB migration: one blob
 * singleton keyed by user display name, the same shape as studio_designs
 * (lib/stores/studio-designs.ts) — a single row whose JSON map holds every
 * user's signature, merged atomically per key by setBlob (punch #62).
 */
import { getBlob, setBlob } from "@/db/doc-store";
import { normalizeSignature } from "@/lib/inbox-signature";

const BLOB_ID = "email_signatures";

type SignatureMap = Record<string, string>;

export async function signatureFor(user: string): Promise<string> {
  if (!user) return "";
  const map = await getBlob<SignatureMap>(BLOB_ID, {});
  return map[user] || "";
}

/** Stores the normalized text (CRLF → LF, trimmed, capped at
 *  SIGNATURE_MAX). Returns what was stored. */
export async function setSignature(text: string, user: string): Promise<string> {
  const clean = normalizeSignature(text);
  await setBlob(BLOB_ID, { [user]: clean });
  return clean;
}

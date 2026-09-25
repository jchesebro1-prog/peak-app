/**
 * #127 — the plain-text email signature. It is body text and nothing more:
 * the composer seeds it below a "-- " separator (the RFC 3676 convention
 * every mail client recognises), the toggle strips/re-inserts it by that
 * separator so edits above it are untouched, and send/MIME see only text.
 * Pure — the composer (client) and the signature store (server) both import
 * this file; no DB, no React.
 */
export const SIGNATURE_MAX = 2000;
export const SIG_SEP = "\n-- \n";
/** thread-reader's Forward block starts with this (openMode). */
export const FORWARD_MARK = "\n\n---------- Forwarded ----------";

export function normalizeSignature(text: string): string {
  return (text || "").replace(/\r\n?/g, "\n").trim().slice(0, SIGNATURE_MAX);
}

/** "" when there is no signature, else "\n\n-- \n" + the normalized text. */
export function signatureBlock(signature: string): string {
  const s = normalizeSignature(signature);
  return s ? "\n" + SIG_SEP + s : "";
}

export function hasSignature(body: string): boolean {
  return (body || "").includes(SIG_SEP);
}

function addSignature(body: string, signature: string): string {
  const block = signatureBlock(signature);
  if (!block || hasSignature(body)) return body;
  // Forward: keep the forwarded block, put the signature above it.
  const fwd = body.indexOf(FORWARD_MARK);
  if (fwd >= 0) return body.slice(0, fwd) + block + body.slice(fwd);
  return body + block;
}

/** Removes the signature: the exact block when it is still intact, else
 *  from the "-- " separator (and the blank line before it) through to the
 *  Forward block that follows it, or to the end of the body when there is
 *  none — so an edited signature still comes out cleanly and a forwarded
 *  block after it survives. I review — this used to cut at the next blank
 *  line instead of the Forward marker, which truncated a MULTI-PARAGRAPH
 *  signature (a blank line between the name and the company block, say) at
 *  its own internal blank line the moment it was edited, leaving the back
 *  half of the signature stuck onto the "stripped" body. */
export function stripSignature(body: string, signature: string): string {
  const block = signatureBlock(signature);
  const exact = block ? body.indexOf(block) : -1;
  if (exact >= 0) return body.slice(0, exact) + body.slice(exact + block.length);
  const sep = body.indexOf(SIG_SEP);
  if (sep < 0) return body;
  const start = sep > 0 && body[sep - 1] === "\n" ? sep - 1 : sep;
  const after = body.indexOf(FORWARD_MARK, sep + SIG_SEP.length);
  return body.slice(0, start) + (after < 0 ? "" : body.slice(after));
}

export function withSignature(body: string, signature: string, mode: "add" | "strip"): string {
  return mode === "add" ? addSignature(body, signature) : stripSignature(body, signature);
}

/**
 * #356 re-review (Minor 4) — Reply all's Cc: the replied-to message's other
 * To / Cc recipients, minus our own addresses (the mailbox and the signed-in
 * person) and the primary contact (who is the To). It used to pre-fill the
 * mailbox's own address. Pure, client-safe.
 */

export type Addr = { raw: string; email: string };

/** Split an address header ("A <a@x>, \"Doe, J\" <j@x>, c@x") on top-level commas; keep each part and its email. */
export function parseAddressList(header: string | null | undefined): Addr[] {
  const s = String(header ?? "");
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = 0;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "<" && !quoted) angle++;
    else if (ch === ">" && !quoted && angle > 0) angle--;
    if ((ch === "," || ch === ";") && !quoted && angle === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const out: Addr[] = [];
  for (const p of parts) {
    const raw = p.replace(/[\r\n]+/g, " ").trim();
    if (!raw) continue;
    const m = /<([^<>\s]+@[^<>\s]+)>/.exec(raw) || /([^\s<>"]+@[^\s<>",;]+)/.exec(raw);
    if (!m) continue;
    out.push({ raw, email: m[1].toLowerCase() });
  }
  return out;
}

/** The Reply all Cc line for a message, or "" when nobody else was on it. */
export function replyAllCc(
  msg: { to?: string | null; cc?: string | null } | null | undefined,
  exclude: ReadonlyArray<string | null | undefined>,
): string {
  if (!msg) return "";
  const skip = new Set(exclude.map((e) => String(e ?? "").trim().toLowerCase()).filter(Boolean));
  const seen = new Set<string>();
  const keep: string[] = [];
  for (const a of [...parseAddressList(msg.to), ...parseAddressList(msg.cc)]) {
    if (skip.has(a.email) || seen.has(a.email)) continue;
    seen.add(a.email);
    keep.push(a.raw);
  }
  return keep.join(", ");
}

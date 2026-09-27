/**
 * #214 — who is on one email: From / To / Cc parsed into participants.
 * Pure (no runtime imports) so test:specs covers it and the link panel's
 * server loader can use it without pulling anything else in.
 */

export type ParticipantRole = "from" | "to" | "cc";

export type Participant = { name: string; email: string; role: ParticipantRole };

/** The slice of a CommMessage this reads (kept structural so the module
 *  needs no store import). */
export type ParticipantSource = {
  direction: "in" | "out";
  author?: string;
  fromEmail?: string;
  to?: string;
  cc?: string;
};

/** Split an address-list header on commas that sit outside double quotes
 *  and angle brackets: `"Hale, Chris" <c@x.org>, d@y.org` → two parts. */
export function splitAddressList(header: string | null | undefined): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  let inAngle = false;
  const s = header || "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && inQuote && i + 1 < s.length) {
      cur += s[i + 1];
      i++;
      continue;
    }
    if (ch === '"') inQuote = !inQuote;
    else if (ch === "<" && !inQuote) inAngle = true;
    else if (ch === ">" && !inQuote) inAngle = false;
    if ((ch === "," || ch === ";") && !inQuote && !inAngle) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/** One mailbox → { name, email }. Quoted display names lose their quotes;
 *  "Last, First" stays as written. email is lowercased; "" when the part
 *  carries no real address. */
export function parseMailbox(part: string): { name: string; email: string } {
  const p = (part || "").trim();
  const angle = /<([^>]*)>\s*$/.exec(p);
  if (angle) {
    const email = angle[1].trim().toLowerCase();
    const name = p
      .slice(0, angle.index)
      .trim()
      .replace(/^"([\s\S]*)"$/, "$1")
      .replace(/\\(.)/g, "$1")
      .trim();
    return { name, email: EMAIL_RE.test(email) ? email : "" };
  }
  const email = p.replace(/^"|"$/g, "").trim().toLowerCase();
  return { name: "", email: EMAIL_RE.test(email) ? email : "" };
}

function lc(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase();
}

/**
 * Everyone on `message`, in From → To → Cc order, deduped by email (first
 * role wins), minus our own addresses (`mailboxAddresses`: the connected
 * mailbox and every team member's emails). An inbound message with no
 * stored fromEmail (app-sent / pre-#125) falls back to `fallbackFrom`
 * (the thread counterpart); outbound From is always us, so it is skipped.
 */
export function participantsOf(
  message: ParticipantSource,
  mailboxAddresses: readonly string[],
  fallbackFrom?: { name: string; email: string } | null
): Participant[] {
  const own = new Set(mailboxAddresses.map(lc).filter(Boolean));
  const seen = new Set<string>();
  const out: Participant[] = [];
  const push = (name: string, email: string, role: ParticipantRole) => {
    const e = lc(email);
    if (!e || own.has(e) || seen.has(e)) return;
    seen.add(e);
    out.push({ name: (name || "").trim(), email: e, role });
  };
  if (message.direction === "in") {
    const from = lc(message.fromEmail);
    if (from) push(message.author || "", from, "from");
    else if (fallbackFrom?.email) push(fallbackFrom.name || message.author || "", fallbackFrom.email, "from");
  }
  for (const part of splitAddressList(message.to)) {
    const a = parseMailbox(part);
    push(a.name, a.email, "to");
  }
  for (const part of splitAddressList(message.cc)) {
    const a = parseMailbox(part);
    push(a.name, a.email, "cc");
  }
  return out;
}

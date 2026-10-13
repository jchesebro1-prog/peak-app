/**
 * Inbox organization §3 "Internal sender": an address is internal when it
 * belongs to a Peak user (team list, users' emails, connected Gmail
 * addresses — the caller passes them all as `teamEmails`) or is on Peak's own
 * domain. The own domain is derived from the team's addresses, or replaced by
 * an optional admin override. Public mail providers are never an own domain:
 * a teammate's connected personal Gmail would otherwise make every Gmail
 * address internal. Pure.
 */

/** Peak's own mail domain — the literal inbox-identity / team.ts / comms'
 *  DEFAULT_DOMAIN have always used. Always an own domain unless an admin
 *  override names the own domains explicitly. */
export const PEAK_OWN_DOMAIN = "peaksystemsgroup.com";

export const FREEMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "protonmail.com", "proton.me", "gmx.com", "mail.com",
  "comcast.net", "att.net", "sbcglobal.net", "charter.net", "verizon.net",
]);

const lc = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

function domainOf(email: string): string {
  const e = lc(email);
  const at = e.lastIndexOf("@");
  return at > 0 ? e.slice(at + 1) : "";
}

const DOMAIN_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/** The own domains: the admin override when it names any (comma/space
 *  separated, `@` and case tolerant), else every non-freemail domain on the
 *  team's addresses. Deduped, in first-seen order. */
export function ownDomainsFrom(teamEmails: string[], override?: string | null): string[] {
  const pick = (list: string[]) => {
    const out: string[] = [];
    for (const raw of list) {
      const d = lc(raw).replace(/^@+/, "");
      if (d && DOMAIN_RE.test(d) && !FREEMAIL_DOMAINS.has(d) && !out.includes(d)) out.push(d);
    }
    return out;
  };
  const tokens = lc(override).split(/[\s,;]+/).filter(Boolean);
  if (tokens.length) return pick(tokens);
  return pick(teamEmails.map(domainOf));
}

/** `(email) => internal?` — a team address, or an address on (or under) an
 *  own domain. */
export function makeInternalChecker(teamEmails: string[], ownDomains: string[]): (email: string) => boolean {
  const team = new Set(teamEmails.map(lc).filter((e) => e.includes("@")));
  const domains = ownDomains.map((d) => lc(d).replace(/^@+/, "")).filter(Boolean);
  return (email: string) => {
    const e = lc(email);
    if (!e.includes("@")) return false;
    if (team.has(e)) return true;
    const d = domainOf(e);
    return !!d && domains.some((own) => d === own || d.endsWith("." + own));
  };
}

/** The shared checker for callers that have no team list in hand (the inbox
 *  identity picker): an address on Peak's own domain (or a subdomain). */
export const isPeakAddress: (email: string) => boolean = makeInternalChecker([], [PEAK_OWN_DOMAIN]);

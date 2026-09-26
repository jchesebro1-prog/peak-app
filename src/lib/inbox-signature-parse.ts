/**
 * #214 — read the sender's signature out of one email body. Deterministic
 * rules only (D89 — no AI): cut the quoted history, find the sign-off,
 * then pick name / title / company / phones / email / website off the
 * lines that follow. Pure (no imports) so test:specs covers it and the
 * Link popup's server loader can call it.
 */

export type SigPhoneLabel = "mobile" | "office" | "other";
export type SigPhone = { label: SigPhoneLabel; number: string };

export type ParsedSignature = {
  name?: string;
  title?: string;
  company?: string;
  phones: SigPhone[];
  email?: string;
  website?: string;
};

export type SignatureSender = { name?: string; email: string };

const MAX_BLOCK_LINES = 12;
// A signature is always short. Bounding the work up front — the tail of the
// (already de-quoted) body, and any single line within it — makes the
// per-line regexes below O(1) per line no matter how large or adversarial
// the inbound body is (#214 review: unbounded line length made EMAIL_RE's
// and URL_RE's unanchored, greedy matching quadratic on a single huge line).
const MAX_TAIL_CHARS = 4000;
const MAX_LINE_CHARS = 200;

const SIGN_OFF_RE =
  /^(--|—|thanks( so much| again)?|thank you( so much)?|many thanks|best( regards| wishes)?|all the best|regards|kind regards|warm regards|warmly|sincerely|cheers|respectfully|take care)[\s,.!]*$/i;

const DEVICE_LINE_RE =
  /^(sent from my \S.*|sent from (mail|outlook|yahoo mail|gmail)\b.*|get outlook for \S.*|sent via \S.*)$/i;

const TITLE_WORDS = [
  "director", "manager", "coordinator", "engineer", "designer", "owner", "president", "vp",
  "vice president", "chair", "chairman", "chairperson", "teacher", "principal", "supervisor",
  "technician", "producer", "head", "lead", "officer", "administrator", "specialist",
  "assistant", "associate", "superintendent", "consultant", "architect", "founder", "partner",
  "ceo", "cfo", "coo", "cto", "executive", "instructor", "professor", "dean", "chief",
  "treasurer", "secretary", "representative", "estimator", "buyer", "planner", "foreman",
];

const COMPANY_WORDS = [
  "school", "schools", "district", "theatre", "theater", "theatres", "theaters", "church",
  "university", "college", "inc", "llc", "ltd", "company", "co", "corp", "corporation",
  "center", "centre", "group", "associates", "architects", "productions", "guild", "arts",
  "studio", "studios", "foundation", "academy", "ministries", "auditorium", "hall",
  "systems", "services", "solutions", "partners",
];

const PUBLIC_ROOTS = new Set([
  "gmail", "googlemail", "yahoo", "outlook", "hotmail", "icloud", "aol", "live", "msn",
  "comcast", "me", "mac", "protonmail", "proton", "ymail", "att", "sbcglobal", "verizon",
]);

// Bounded quantifiers ({1,64} etc., matching the real-world length limits
// for an email local part / DNS label) so a run of "word" characters with no
// '@' or no matching TLD fails in bounded time instead of backtracking over
// the whole line (#214 review).
const EMAIL_RE = /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,255}\.[A-Z]{2,24}/i;
const URL_RE =
  /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?){0,10}\.(?:com|org|net|edu|us|gov|io|co|biz|info|church|theater|theatre|arts)(?:\/[^\s|,]{0,200})?/i;
const PHONE_RE =
  /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?:\s*(?:x|ext\.?|extension)\s*(\d{1,6}))?/gi;
const MOBILE_TOKEN_RE = /(?:^|[^a-z])(m|c|cell|mobile|mob)\.?\s*[:.]?\s*$/i;
const OFFICE_TOKEN_RE =
  /(?:^|[^a-z])(o|d|t|p|w|office|direct|tel|ph|phone|work|main)\.?\s*[:.]?\s*$/i;
const ADDRESS_RE = /^\d+\s+[A-Za-z]|,\s*[A-Z]{2}\s+\d{5}(-\d{4})?\b|\b(p\.?o\.?\s*box)\b/i;

function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
}

function alnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasWord(line: string, list: readonly string[]): boolean {
  const lw = " " + words(line).join(" ") + " ";
  return list.some((w) => lw.includes(" " + w + " "));
}

/** Cut replies/forwards off the bottom, drop `>` quoting and device
 *  footers ("Sent from my iPhone"). Normalises CRLF. */
export function stripQuotedHistory(body: string): string {
  const lines = (body || "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^-{2,}\s*(original message|forwarded message)\s*-{2,}$/i.test(t)) break;
    if (/^_{5,}$/.test(t)) break;
    if (/^on\s.+/i.test(t) && lines.slice(i, i + 3).join(" ").includes("wrote:")) break;
    if (/^from:\s*\S/i.test(t) && lines.slice(i + 1, i + 5).some((l) => /^(sent|date):\s*\S/i.test(l.trim()))) break;
    if (t.startsWith(">")) continue;
    if (DEVICE_LINE_RE.test(t)) continue;
    out.push(lines[i]);
  }
  return out.join("\n");
}

function formatPhone(m: RegExpExecArray): string {
  const base = `(${m[1]}) ${m[2]}-${m[3]}`;
  return m[4] ? `${base} x${m[4]}` : base;
}

function phonesIn(line: string): SigPhone[] {
  const out: SigPhone[] = [];
  const re = new RegExp(PHONE_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const before = line.slice(Math.max(0, m.index - 14), m.index);
    const after = line.slice(m.index + m[0].length, m.index + m[0].length + 10);
    let label: SigPhoneLabel = "other";
    if (MOBILE_TOKEN_RE.test(before) || /^\s*\(?(cell|mobile|m)\)?(\W|$)/i.test(after)) label = "mobile";
    else if (OFFICE_TOKEN_RE.test(before) || /^\s*\(?(office|work|direct|o)\)?(\W|$)/i.test(after)) label = "office";
    out.push({ label, number: formatPhone(m) });
  }
  return out;
}

function isContactLine(line: string): boolean {
  return new RegExp(PHONE_RE.source, "i").test(line) || EMAIL_RE.test(line) || URL_RE.test(line) || ADDRESS_RE.test(line);
}

function isNameShaped(line: string): boolean {
  if (/[0-9@]/.test(line) || /[?!:;.]$/.test(line)) return false;
  const n = line.split(/\s+/).filter(Boolean).length;
  return n >= 1 && n <= 5;
}

const DISCLAIMER_WORDS = ["confidential", "intended", "privileged", "recipient", "disclaimer", "unsubscribe"];

/** A sentence — legal boilerplate, not a company name. Mirrors
 *  isNameShaped's punctuation guard, plus a lowercase start (boilerplate
 *  reads as prose, not a proper noun) and the disclaimer vocabulary.
 *  Used to stop the company fallback from reading into a confidentiality
 *  footer (#214 review: "This email ... are addressed." was mistaken for
 *  a company). */
function isBoilerplateLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/[.?!:;]$/.test(t)) return true;
  if (/^[a-z]/.test(t)) return true;
  if (hasWord(t, DISCLAIMER_WORDS)) return true;
  return false;
}

/** "Chris Hale, AIA" → "Chris Hale" (credentials after a comma go). */
function cleanName(line: string): string {
  const comma = line.indexOf(",");
  if (comma > 0 && line.slice(0, comma).trim().split(/\s+/).length >= 2) return line.slice(0, comma).trim();
  return line.trim();
}

function domainRoot(email: string): string {
  const host = (email.split("@")[1] || "").toLowerCase().replace(/^www\./, "");
  const root = host.split(".")[0] || "";
  return PUBLIC_ROOTS.has(root) ? "" : alnum(root);
}

function matchesDomain(line: string, root: string): boolean {
  if (root.length < 4) return false;
  const a = alnum(line);
  return a.length >= 4 && (a.includes(root) || root.includes(a));
}

export function extractSignature(
  body: string,
  sender: SignatureSender
): ParsedSignature | null {
  const stripped = stripQuotedHistory(body);
  // Only the tail can hold a signature, and a signature line is never long
  // — bound both so a sender-controlled body of any size costs the same to
  // scan (#214 review: an unbounded body/line let EMAIL_RE/URL_RE/PHONE_RE
  // backtrack quadratically).
  const tail = stripped.length > MAX_TAIL_CHARS ? stripped.slice(-MAX_TAIL_CHARS) : stripped;
  const lines = tail
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.length <= MAX_LINE_CHARS);
  if (!lines.length) return null;

  const senderTokens = words(sender.name || "").filter((w) => w.length >= 2);
  const root = domainRoot(sender.email || "");

  // The block: after the last sign-off that still has lines under it; with
  // no sign-off, from the last-12 line that names the sender; with neither,
  // the last 12 lines, read for contact details only (no name/title/company).
  let signOff = -1;
  for (let i = lines.length - 2; i >= 0; i--) {
    if (SIGN_OFF_RE.test(lines[i])) {
      signOff = i;
      break;
    }
  }
  let block: string[];
  let trusted: boolean;
  if (signOff >= 0) {
    block = lines.slice(signOff + 1, signOff + 1 + MAX_BLOCK_LINES);
    trusted = true;
  } else {
    const tail = lines.slice(-MAX_BLOCK_LINES);
    const at = tail.findIndex(
      (l) => isNameShaped(cleanName(l)) && !isContactLine(l) && senderTokens.some((t) => words(l).includes(t))
    );
    block = at >= 0 ? tail.slice(at) : tail;
    trusted = at >= 0;
  }

  const phones: SigPhone[] = [];
  let email: string | undefined;
  let website: string | undefined;
  for (const l of block) {
    for (const p of phonesIn(l)) if (!phones.some((x) => x.number === p.number)) phones.push(p);
    const em = EMAIL_RE.exec(l);
    if (em && !email) email = em[0].toLowerCase();
    const withoutEmail = em ? l.replace(em[0], " ") : l;
    const url = URL_RE.exec(withoutEmail);
    if (url && !website) website = url[0];
  }

  let name: string | undefined;
  let title: string | undefined;
  let company: string | undefined;

  if (trusted) {
    const head = block.slice(0, 3);
    let nameIdx = head.findIndex(
      (l) => isNameShaped(cleanName(l)) && !isContactLine(l) && senderTokens.some((t) => words(l).includes(t))
    );
    if (nameIdx < 0) {
      nameIdx = head.findIndex(
        (l) =>
          !isContactLine(l) &&
          !hasWord(l, TITLE_WORDS) &&
          /^[A-Z][A-Za-z'’.-]*(\s+[A-Z][A-Za-z'’.-]*){1,3}$/.test(cleanName(l))
      );
    }
    if (nameIdx >= 0) {
      const raw = cleanName(block[nameIdx]);
      const rawWords = words(raw);
      name =
        senderTokens.length > rawWords.length && rawWords.every((w) => senderTokens.includes(w))
          ? (sender.name || "").trim()
          : raw;

      const rest = block.slice(nameIdx + 1).filter((l) => !isContactLine(l));
      const next = rest[0];
      let afterTitle = 0;
      if (next) {
        const parts = next.split(/\s+\|\s+/).map((s) => s.trim()).filter(Boolean);
        if (parts.length > 1 && parts.some((p) => hasWord(p, TITLE_WORDS))) {
          title = parts.find((p) => hasWord(p, TITLE_WORDS));
          company = parts.find((p) => p !== title);
          afterTitle = 1;
        } else if (matchesDomain(next, root)) {
          // the company line sits right under the name — no title
        } else if (hasWord(next, TITLE_WORDS)) {
          title = next;
          afterTitle = 1;
        } else if (
          !hasWord(next, COMPANY_WORDS) &&
          next.split(/\s+/).length <= 6 &&
          !/\d/.test(next) &&
          rest.length > 1
        ) {
          title = next;
          afterTitle = 1;
        }
      }
      if (!company) {
        // Stop at the first boilerplate-shaped line — a confidentiality
        // footer often continues for several more lines that would
        // otherwise still look like a short, digit-free "company" line.
        const rawCandidates = rest.slice(afterTitle);
        const cutIdx = rawCandidates.findIndex((l) => isBoilerplateLine(l));
        const candidates = cutIdx >= 0 ? rawCandidates.slice(0, cutIdx) : rawCandidates;
        company =
          candidates.find((l) => matchesDomain(l, root)) ||
          candidates.find((l) => l.split(/\s+/).length <= 8 && !/\d/.test(l));
      }
    }
  }

  if (!name && !title && !company && !phones.length && !website) return null;
  const out: ParsedSignature = { phones };
  if (name) out.name = name;
  if (title) out.title = title;
  if (company) out.company = company;
  if (email) out.email = email;
  if (website) out.website = website;
  return out;
}

/** What a KNOWN contact lacks that the signature carries — the "Add
 *  missing details" list. Title only when the contact has none; a phone
 *  only when its last 10 digits aren't already on file. Never proposes
 *  overwriting anything. */
export function missingContactFields(
  contact: { title: string | null | undefined; phones: readonly string[] },
  sig: ParsedSignature | null
): { title?: string; phones: SigPhone[] } {
  const out: { title?: string; phones: SigPhone[] } = { phones: [] };
  if (!sig) return out;
  if (sig.title && !(contact.title || "").trim()) out.title = sig.title;
  const have = new Set(
    contact.phones.map((p) => p.replace(/\s*(x|ext\.?)\s*\d+$/i, "").replace(/\D/g, "").slice(-10)).filter(Boolean)
  );
  for (const p of sig.phones) {
    const key = p.number.replace(/\s*x\d+$/, "").replace(/\D/g, "").slice(-10);
    if (!have.has(key)) {
      have.add(key);
      out.phones.push(p);
    }
  }
  return out;
}

/** The one company a signature's company line names, by exact
 *  (case/punctuation-insensitive) name — null when none or several. */
export function companyByExactName(
  name: string | null | undefined,
  companies: ReadonlyArray<{ id: string; name: string }>
): string | null {
  const key = alnum(name || "");
  if (!key) return null;
  const hits = companies.filter((c) => alnum(c.name) === key);
  return hits.length === 1 ? hits[0].id : null;
}

/** A signature phone label → the identity core's channel label
 *  (identity/config CHANNEL_LABELS: work | mobile | home | other). */
export function channelLabelFor(label: SigPhoneLabel): "mobile" | "work" | "other" {
  return label === "office" ? "work" : label;
}

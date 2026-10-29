/**
 * Business-card OCR lines → contact fields. Pure and rules-based (no AI, D89).
 * It never invents a value: a field it can't place stays blank, and staff
 * check every field before saving.
 *
 * Order of work: pull out the unambiguous tokens (email, website, phones),
 * drop address/marketing lines, split "Name | Title" lines, then pick the
 * name (2–4 name-like words, backed by the email's local part), the company
 * (matches the email/web domain, else has a corporate/venue word) and the
 * title (keyword list) from what's left.
 */

export type ParsedCard = { name: string; email: string; phones: string[]; website: string; company: string; title: string };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// host with a common TLD, optional scheme / www.
const URL_RE = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|us|co|io|biz|info|gov))\b/i;
// 10-digit North American number, optional +1, optional "ext. 12"; never part of a longer digit run
const PHONE_BODY = String.raw`(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:ext\.?|x)\s*\d{1,5})?(?!\d)`;
// an optional label word right before the number: group 1 = label, group 2 = the number
const PHONE_LABELLED = new RegExp(String.raw`(?:\b(p|o|m|t|c|f|w|h|tel|phone|office|mobile|cell|fax|direct)\b\.?\s*:?\s*)?(${PHONE_BODY})`, "gi");
const FAX_LABEL = /^(?:f|fax)$/i;
// leftover "E:" / "Web:" style labels once the value itself is pulled out
const VALUE_LABEL = /\b(?:e|w|web|website|email|e-mail|url)\b\s*[:.]?/gi;

// street address (number + street word), suite/floor, PO box, "City, ST 12345"
const STREET_LINE = /^\d+\s.*\b(?:street|st|avenue|ave|road|rd|blvd|boulevard|drive|dr|lane|ln|way|highway|hwy|court|ct)\b\.?/i;
const UNIT_LINE = /\b(?:suite|ste|floor|p\.?\s?o\.?\s?box)\b/i;
const STATE_ZIP = /,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/;
const NOISE = /\b(thank you|booth|visit us)\b/i;

const TITLE_WORDS = /\b(director|manager|president|vp|vice president|owner|principal|engineer|designer|teacher|pastor|rep(?:resentative)?|sales|coordinator|supervisor|technician|stage manager|administrator|superintendent|founder|partner|ceo|cfo|coo|cto|executive|head|lead|officer|consultant|specialist|chair|dean|professor|producer)\b/i;
const COMPANY_WORDS = /\b(inc\.?|llc|ltd|corp\.?|company|co\.|group|associates|school|district|university|college|church|parish|theatre|theater|arena|center|centre|pac|opera|staging|supply|audio|lighting|rigging|integration|consulting|systems|productions?|studios?)\b/i;
const HONORIFIC = /^(mr|mrs|ms|dr|fr|rev)\.?\s+/i;
const CREDENTIAL = /,\s*(cts(?:-[di])?|pe|phd|ma|mfa|cpa|esq\.?)$/i;
// a capitalised name word, a lowercase particle (del, van…) or a middle initial
const NAME_WORD = /^\p{Lu}[\p{L}'’-]+$|^(?:del|de|la|van|von|da|di|le)$|^\p{Lu}\.$/u;

const FREE_MAIL = ["gmail", "yahoo", "outlook", "hotmail", "icloud", "aol", "msn", "live", "comcast"];
// all-caps words that stay all-caps when a shouting line is title-cased
const ACRONYMS = new Set(["VP", "AV", "IT", "HR", "CEO", "CFO", "COO", "CTO", "LLC", "PAC", "LED", "DJ", "USA"]);

/** "MARK OYELARAN" → "Mark Oyelaran"; mixed-case text is left exactly as printed. */
function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s
    .split(/(\s+)/)
    .map((w) => {
      const bare = w.replace(/[^A-Za-z]/g, "");
      if (ACRONYMS.has(bare)) return w;
      return w.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
    })
    .join("");
}

function nameWords(s: string): string[] {
  return s.replace(HONORIFIC, "").replace(CREDENTIAL, "").trim().split(/\s+/).filter(Boolean);
}

function looksLikeName(s: string): boolean {
  const words = nameWords(s);
  if (words.length < 2 || words.length > 4) return false;
  if (TITLE_WORDS.test(s) || COMPANY_WORDS.test(s) || /\d|@/.test(s)) return false;
  return words.every((w) => NAME_WORD.test(titleCase(w)) || NAME_WORD.test(w));
}

/** First label of the email/web host ("riversidepac"), blank for free mail. */
function domainOf(email: string, website: string): string {
  const host = (email.split("@")[1] || website).replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const parts = host.toLowerCase().split(".");
  if (FREE_MAIL.includes(parts[0])) return "";
  return parts.length >= 2 ? parts[0] : "";
}

function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Does this line look like the organisation behind the domain? Prefix of the domain inside the line ("riversidepac" ⊂ Riverside…), else initials ("nlu" = Northern Lakes University). */
function matchesDomain(line: string, dom: string): boolean {
  if (!dom) return false;
  const sq = squash(line);
  if (dom.length >= 4) {
    const min = Math.min(dom.length, 5);
    for (let n = Math.min(dom.length, 8); n >= min; n--) if (sq.includes(dom.slice(0, n))) return true;
  }
  const initials = line.split(/[^A-Za-z0-9]+/).filter((w) => w && !/^(of|the|and|for)$/i.test(w)).map((w) => w[0].toLowerCase()).join("");
  return dom.length >= 3 && initials.length >= 3 && (initials === dom || initials.startsWith(dom));
}

export function parseCardText(input: string[]): ParsedCard {
  const out: ParsedCard = { name: "", email: "", phones: [], website: "", company: "", title: "" };
  const rest: string[] = [];
  for (const raw of input) {
    let line = String(raw || "").replace(/\s+/g, " ").trim();
    if (!line) continue;
    let pulled = false;

    const em = line.match(EMAIL);
    if (em) {
      if (!out.email) out.email = em[0];
      line = line.replace(em[0], " ");
      pulled = true;
    }
    // phones: the number only (label dropped); a number labelled fax is discarded
    line = line.replace(PHONE_LABELLED, (_all, label: string | undefined, num: string) => {
      if (!(label && FAX_LABEL.test(label))) {
        const n = num.trim();
        if (!out.phones.includes(n)) out.phones.push(n);
      }
      pulled = true;
      return " ";
    });
    const url = line.match(URL_RE);
    if (url) {
      if (!out.website) out.website = url[1];
      line = line.replace(url[0], " ");
      pulled = true;
    }
    if (pulled) {
      line = line.replace(VALUE_LABEL, " ");
      if (line.replace(/[^A-Za-z]/g, "").length <= 3) continue; // nothing left but a label or stray letters
    }
    line = line.replace(/\s+/g, " ").replace(/^[|,;:\s]+|[|,;:\s]+$/g, "").trim();
    if (!line || NOISE.test(line) || STREET_LINE.test(line) || UNIT_LINE.test(line) || STATE_ZIP.test(line)) continue;
    // "Name | Title" on one line
    for (const part of line.split(/\s*\|\s*/)) if (part) rest.push(part);
  }

  const dom = domainOf(out.email, out.website);
  const local = squash((out.email.split("@")[0] || "").replace(/[^A-Za-z]/g, ""));
  const used = new Set<number>();

  // name: name-like lines, ranked by the email's local part ("lbrandt" backs "Leah Brandt");
  // a line that is really the company (matches the domain, not the local part) is not a name
  let bestScore = -1;
  let ni = -1;
  rest.forEach((l, i) => {
    if (!looksLikeName(l)) return;
    const w = nameWords(l).map((x) => squash(x)).filter((x) => x.length >= 3);
    const local_ = !!local && w.length > 0 && (local.includes(w[w.length - 1]) || local.includes(w[0]));
    const score = local_ ? 2 : matchesDomain(l, dom) ? -1 : 0;
    if (score > bestScore) { bestScore = score; ni = i; }
  });
  if (ni >= 0) {
    used.add(ni);
    out.name = titleCase(nameWords(rest[ni]).join(" "));
  }
  // company: the line matching the email/web domain, else the first line with a company word that isn't a title
  let ci = rest.findIndex((l, i) => !used.has(i) && !TITLE_WORDS.test(l) && matchesDomain(l, dom));
  if (ci < 0) ci = rest.findIndex((l, i) => !used.has(i) && COMPANY_WORDS.test(l) && !TITLE_WORDS.test(l));
  if (ci >= 0) {
    used.add(ci);
    out.company = titleCase(rest[ci]);
  }
  // title: first remaining line with a title word
  const ti = rest.findIndex((l, i) => !used.has(i) && TITLE_WORDS.test(l));
  if (ti >= 0) {
    used.add(ti);
    out.title = titleCase(rest[ti]);
  }
  return out;
}

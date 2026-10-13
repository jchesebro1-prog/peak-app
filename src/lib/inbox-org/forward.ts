/**
 * Inbox organization §3 "Forwards" — is a message a forward, who/what was
 * forwarded, and is the note on top FYI-only. Also `ownText`: the part of a
 * message body its author actually wrote (quoted reply text, forwarded
 * blocks, the `-- ` signature and mobile footers removed), shared with the
 * sign-off check. Pure.
 *
 * Formats handled:
 *  - Gmail:   `---------- Forwarded message ---------` + From/Date/Subject/To
 *  - Peak:    `---------- Forwarded ----------` + `From: <name>` (thread-reader)
 *  - Apple:   `Begin forwarded message:` + From/Subject/Date/To
 *  - Outlook: `From: … Sent: … To: … Subject:` (optionally under a
 *             `________________________________` rule or `-----Original Message-----`,
 *             `[mailto:…]` addresses, `*From:*` bold labels) — only with an
 *             `FW:`/`Fwd:` subject, because Outlook writes the same block for a reply.
 * A `Re:` subject is never a forward (a reply quoting a forward isn't one).
 * Nested forwards (Pat → Ann → Bob → me): given `isInternal`, a first block
 * from a teammate is followed inward to the OUTERMOST external sender.
 */
import { parseAddress } from "@/lib/gmail/mime";

export type ParsedForward = {
  isForward: boolean;
  original: { fromEmail: string; fromName: string; subject: string; date: string } | null;
  note: string;
  fyi: boolean;
};

const FWD_SUBJECT = /^\s*fwd?\s*:/i;
const FWD_PREFIXES = /^\s*(?:(?:fwd?|re|aw|sv)\s*:\s*)+/i;
const REPLY_SUBJECT = /^\s*(?:re|aw|sv)\s*:/i;

const EXPLICIT_MARKER = /^\s*(?:-{2,}\s*Forwarded(?: message)?\s*-{2,}|Begin forwarded message:)\s*$/i;
const OUTLOOK_RULE = /^\s*(?:-{2,}\s*Original Message\s*-{2,}|_{8,})\s*$/i;
const HEADER = /^\s*(From|Date|Sent|Subject|To|Cc|Reply-To)\s*:\s*(.*)$/i;
const FROM_HEADER = /^\s*From\s*:/i;
const SENT_OR_DATE = /^\s*(?:Sent|Date)\s*:/i;
const WROTE = /wrote:\s*$/i;
const SIG_LINE = /^--\s*$/;
const MOBILE_FOOTER = /^\s*(?:sent from my |get outlook for )/i;

const unbold = (l: string) => l.replace(/\*/g, "");

function linesOf(body: string): string[] {
  return String(body ?? "").replace(/\r\n?/g, "\n").split("\n");
}

/** A reply's quote starts here: an "On … wrote:" line (or one split over two
 *  lines), else the first `>` line. */
function replyCutoff(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*>/.test(l)) return i;
    if (/^\s*On\s.+/i.test(l) && (WROTE.test(l) || WROTE.test(lines[i + 1] || ""))) return i;
  }
  return lines.length;
}

/** A bare Outlook header block starts at `i`: a From: line with a Sent:/Date:
 *  line among the next few. */
function outlookBlockAt(lines: string[], i: number): boolean {
  if (!FROM_HEADER.test(unbold(lines[i]))) return false;
  for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) if (SENT_OR_DATE.test(unbold(lines[j]))) return true;
  return false;
}

/** The first line of a header block that follows a rule/marker at `i` (blank
 *  lines skipped), when it is a From: line. */
function headerAfter(lines: string[], i: number): number {
  let j = i + 1;
  while (j < lines.length && !lines[j].trim()) j++;
  return j < lines.length && FROM_HEADER.test(unbold(lines[j])) ? j : -1;
}

type Block = { at: number; headerStart: number; explicit: boolean };

/** Where a forwarded block starts in the author's part of the body, if any. */
function findBlock(lines: string[], allowOutlook: boolean): Block | null {
  const end = replyCutoff(lines);
  for (let i = 0; i < end; i++) {
    if (EXPLICIT_MARKER.test(lines[i])) return { at: i, headerStart: i + 1, explicit: true };
    if (!allowOutlook) continue;
    if (OUTLOOK_RULE.test(lines[i])) {
      const h = headerAfter(lines, i);
      if (h >= 0) return { at: i, headerStart: h, explicit: false };
    }
    if (outlookBlockAt(lines, i)) return { at: i, headerStart: i, explicit: false };
  }
  return null;
}

/** The text its author wrote: everything above the first quoted reply,
 *  forwarded block (any format), `-- ` signature or mobile footer; `>` lines
 *  dropped. Trimmed. */
export function ownText(body: string): string {
  const lines = linesOf(body);
  const end = replyCutoff(lines);
  const out: string[] = [];
  for (let i = 0; i < end; i++) {
    const l = lines[i];
    if (EXPLICIT_MARKER.test(l) || SIG_LINE.test(l.trim()) || MOBILE_FOOTER.test(l)) break;
    if (OUTLOOK_RULE.test(l) && headerAfter(lines, i) >= 0) break;
    if (outlookBlockAt(lines, i)) break;
    out.push(l);
  }
  return out.join("\n").trim();
}

function parseFrom(v: string): { fromName: string; fromEmail: string } {
  const value = v.trim();
  const mailto = /^(.*?)\s*\[mailto:([^\]]+)\]\s*$/i.exec(value);
  if (mailto) return { fromName: mailto[1].replace(/^"|"$/g, "").trim(), fromEmail: mailto[2].trim().toLowerCase() };
  const a = parseAddress(value);
  if (a.email.includes("@") && !/\s/.test(a.email)) return { fromName: a.name.replace(/^"|"$/g, "").trim(), fromEmail: a.email };
  return { fromName: value.replace(/^"|"$/g, "").replace(/\s*<\s*>\s*$/, "").trim(), fromEmail: "" };
}

function readHeaders(lines: string[], start: number): { h: Record<string, string>; end: number } {
  const h: Record<string, string> = {};
  let i = start;
  while (i < lines.length && !lines[i].trim()) i++;
  for (; i < lines.length; i++) {
    const m = HEADER.exec(unbold(lines[i]));
    if (!m) break;
    const key = m[1].toLowerCase();
    if (!(key in h)) h[key] = m[2].trim();
  }
  return { h, end: i };
}

type Original = NonNullable<ParsedForward["original"]>;

function originalOf(lines: string[], block: Block, subj: string): Original | null {
  const { h } = readHeaders(lines, block.headerStart);
  if (h.from === undefined) return null;
  const { fromName, fromEmail } = parseFrom(h.from);
  return { fromEmail, fromName, subject: h.subject ?? subj.replace(FWD_PREFIXES, "").trim(), date: h.date ?? h.sent ?? "" };
}

/** The original of the first block, then of every forwarded block nested
 *  inside it, outermost first. Nested blocks may sit under `>` quoting (Peak's
 *  own Forward quotes the forwarded text), so the scan reads lines with the
 *  quote marks off. */
function nestedOriginals(lines: string[], first: Block, subj: string): Original[] {
  const plain = lines.map((l) => l.replace(/^(?:\s*>)+\s?/, ""));
  const blocks = [first];
  for (let i = readHeaders(plain, first.headerStart).end; i < plain.length; i++) {
    let b: Block | null = null;
    if (EXPLICIT_MARKER.test(plain[i])) b = { at: i, headerStart: i + 1, explicit: true };
    else if (OUTLOOK_RULE.test(plain[i])) {
      const h = headerAfter(plain, i);
      if (h >= 0) b = { at: i, headerStart: h, explicit: false };
    } else if (outlookBlockAt(plain, i)) b = { at: i, headerStart: i, explicit: false };
    if (!b) continue;
    blocks.push(b);
    i = Math.max(i, readHeaders(plain, b.headerStart).end - 1);
  }
  return blocks.map((b) => originalOf(plain, b, subj)).filter((o): o is Original => o !== null);
}

const FYI = /(?:^|[^\p{L}])(?:fyi|f\.y\.i)(?=[^\p{L}]|$)|\bfor your (?:records|files|information|info|reference)\b|\bno action\b|\bnothing (?:needed|to do)\b|\bjust so you know\b|\bfor reference\b/iu;
const ASK = /\b(?:please|pls|can you|could you|would you|will you|need(?:s)? you|let me know|lmk|follow up|get back to|take care of|reach out|handle (?:this|it)|your call)\b/i;

/** FYI-only: an FYI phrase, no question, nothing asked of the reader. */
function isFyiNote(note: string): boolean {
  return !!note && !note.includes("?") && FYI.test(note) && !ASK.test(note);
}

/** `isInternal` (optional): when the first forwarded block's sender is
 *  internal (a teammate passing along a teammate's forward), report the
 *  outermost nested block whose sender is external — the customer who wrote
 *  to us, walking inward — else the innermost block. Without it, the first block is reported. */
export function parseForward(subject: string, body: string, isInternal?: (email: string) => boolean): ParsedForward {
  const subj = String(subject ?? "");
  const notForward: ParsedForward = { isForward: false, original: null, note: "", fyi: false };
  if (REPLY_SUBJECT.test(subj)) return notForward;
  const subjectFwd = FWD_SUBJECT.test(subj);
  const lines = linesOf(body);
  const block = findBlock(lines, subjectFwd);
  if (!subjectFwd && !block) return notForward;

  let original: ParsedForward["original"] = block ? originalOf(lines, block, subj) : null;
  if (block && original && isInternal && original.fromEmail && isInternal(original.fromEmail)) {
    const all = nestedOriginals(lines, block, subj);
    const external = all.find((o) => o.fromEmail && !isInternal(o.fromEmail));
    original = external ?? all[all.length - 1] ?? original;
  }
  const note = ownText(body);
  return { isForward: true, original, note, fyi: isFyiNote(note) };
}

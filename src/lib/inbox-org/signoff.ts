/**
 * Inbox organization §3 — a customer message that only signs off ("Thanks!",
 * "Got it", "Sounds good") puts the ball in nobody's court. Pure.
 *
 * Rule: take the author's own text (`ownText`: quoted reply, forwarded
 * block, `-- ` signature and mobile footer removed); refuse any "?"; drop a
 * trailing signature block (from the first valediction or name-like line
 * after the first line); the rest must be at most 8 words, contain one of the
 * sign-off phrases, and nothing else but filler ("so much", "for the quote")
 * and up to two capitalised name words ("Thanks Jeff!") — never an action
 * word ("Send Invoice", "Declined": `NOT_NAMES`).
 */
import { ownText } from "./forward";

export const SIGN_OFF_MAX_WORDS = 8;

const PHRASES: string[][] = [
  "thank you", "got it", "sounds good", "will do", "appreciate it", "much appreciated", "many thanks",
  "you too", "talk soon", "have a great day", "have a great weekend", "have a great week",
  "have a good day", "have a good weekend", "have a good one",
].map((p) => p.split(" "));
const WORDS = new Set(["thanks", "thx", "ty", "perfect", "great", "ok", "okay", "awesome", "noted", "received", "excellent", "wonderful", "cool", "cheers", "appreciated"]);
const FILLER = new Set([
  "so", "much", "very", "again", "a", "lot", "bunch", "ton", "all", "the", "for", "your", "help", "quick",
  "response", "reply", "info", "information", "update", "quote", "and", "everyone", "guys", "too", "sir", "maam", "ma'am",
]);
const PRONOUNS = new Set(["i", "i'll", "i'm", "i've", "i'd", "we", "we'll", "we're"]);

const VALEDICTION = /^(?:best|best regards|regards|kind regards|warm regards|warmly|cheers|sincerely|respectfully|thanks|thank you|many thanks|take care|-+)[\s,.!]*$/i;
/** A name line: 1–3 capitalised words (an optional leading dash), none of
 *  them an action word — so "Send Invoice" / "Declined" under "Thanks!" stay
 *  part of the message instead of passing as a signature. */
const NAME_LINE = /^[-–—~]*\s*\p{Lu}[\p{L}'.-]*(?:\s+\p{Lu}[\p{L}'.-]*){0,2}\s*$/u;
/** Action / status words that are never a name. */
const NOT_NAMES = new Set([
  "send", "sent", "resend", "please", "call", "decline", "declined", "approve", "approved", "confirm", "confirmed",
  "check", "cancel", "cancelled", "canceled", "pay", "paid", "order", "ordered", "ship", "shipped", "sign", "signed",
  "schedule", "scheduled", "update", "updated", "review", "attach", "attached", "need", "needed", "stop", "hold",
  "wait", "invoice", "quote", "yes", "no", "not", "email", "reply", "book", "booked", "reject", "rejected",
]);
const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}']/gu, "");
const isNameLine = (line: string) =>
  NAME_LINE.test(line) && !line.replace(/^[-–—~\s]+/, "").split(/\s+/).some((w) => NOT_NAMES.has(bare(w)));

function bodyCore(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let cut = lines.length;
  for (let i = 1; i < lines.length; i++) {
    if (VALEDICTION.test(lines[i]) || isNameLine(lines[i])) {
      cut = i;
      break;
    }
  }
  return lines.slice(0, cut).join(" ");
}

export function isSignOff(body: string): boolean {
  const text = ownText(body);
  if (!text || text.includes("?")) return false;
  const words = bodyCore(text)
    .replace(/[‘’]/g, "'")
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean)
    .map((orig) => ({ orig, low: orig.toLowerCase() }));
  if (!words.length || words.length > SIGN_OFF_MAX_WORDS) return false;

  let hit = false;
  const residue: string[] = [];
  for (let i = 0; i < words.length; ) {
    const phrase = PHRASES.find((p) => p.every((t, k) => words[i + k]?.low === t));
    if (phrase) {
      hit = true;
      i += phrase.length;
      continue;
    }
    const w = words[i];
    if (WORDS.has(w.low)) hit = true;
    else if (!FILLER.has(w.low)) residue.push(w.orig);
    i++;
  }
  if (!hit || residue.length > 2) return false;
  return residue.every((w) => /^\p{Lu}/u.test(w) && !PRONOUNS.has(w.toLowerCase()) && !NOT_NAMES.has(bare(w)));
}

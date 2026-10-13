/**
 * Inbox organization §3 — a customer message that only signs off ("Thanks!",
 * "Got it", "Sounds good") puts the ball in nobody's court. Pure.
 *
 * Rule: take the author's own text (`ownText`: quoted reply, forwarded
 * block, `-- ` signature and mobile footer removed); refuse any "?"; drop a
 * trailing signature block (from the first valediction or name-like line
 * after the first line); the rest must be at most 8 words, contain one of the
 * sign-off phrases, and nothing else but filler ("so much", "for the quote")
 * and up to two capitalised name words ("Thanks Jeff!").
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
const NAME_LINE = /^[-–—~]*\s*\p{Lu}[\p{L}'.-]*(?:\s+\p{Lu}[\p{L}'.-]*){0,3}\s*$/u;

function bodyCore(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let cut = lines.length;
  for (let i = 1; i < lines.length; i++) {
    if (VALEDICTION.test(lines[i]) || NAME_LINE.test(lines[i])) {
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
  return residue.every((w) => /^\p{Lu}/u.test(w) && !PRONOUNS.has(w.toLowerCase()));
}

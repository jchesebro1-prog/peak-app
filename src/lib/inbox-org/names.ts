/**
 * Inbox organization (#335, D894) — does a message's own text name a team
 * member? Used by the court rules (a teammate's "Jeff will call you" is a
 * hand-off to Jeff) and by the promise-task owner check (the model may only
 * route a task to someone the newest message actually names). Pure.
 *
 * A person's names are their first name and their full name, taken from the
 * team list's display name; words with digits or symbols ("TEST335") are not
 * name words. Matching is case-insensitive and word-bounded — except a first
 * name that is also an everyday word ("Will", "Mark", "Grant"), which only
 * matches capitalised, so "I will send it" never names Will.
 */
import { ownText } from "./forward";

const COMMON_WORD_NAMES: ReadonlySet<string> = new Set([
  "will", "mark", "bill", "grant", "chase", "hope", "joy", "rich", "may", "june", "art", "max", "frank", "dean",
  "drew", "guy", "ray", "rob", "sue", "faith", "lance", "miles", "penny", "rose", "summer", "august", "sandy",
  "gene", "don", "jack", "case", "cash", "dawn", "bob", "carol", "april", "glen", "hunter",
]);

const NAME_WORD = /^\p{L}[\p{L}'’.-]*$/u;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The name words of a display name ("TEST335 Ari" → ["Ari"]). */
export function nameWords(name: string | null | undefined): string[] {
  return String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter((w) => NAME_WORD.test(w));
}

/** `text` names the person called `name` (first or full name). */
export function mentionsName(text: string, name: string | null | undefined): boolean {
  const words = nameWords(name);
  if (!words.length || !text) return false;
  const bound = (s: string, flags: string) => new RegExp(`(?<![\\p{L}\\p{N}])${s}(?![\\p{L}\\p{N}])`, flags);
  if (words.length > 1 && bound(words.map(esc).join("\\s+"), "iu").test(text)) return true;
  const first = words[0];
  if (COMMON_WORD_NAMES.has(first.toLowerCase())) {
    const cap = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    return bound(esc(cap), "u").test(text) || bound(esc(first.toUpperCase()), "u").test(text);
  }
  return bound(esc(first), "iu").test(text);
}

/** The author's own words in `body` (quoted replies, forwarded blocks and
 *  signatures stripped) name the person called `name`. */
export function ownTextNames(body: string, name: string | null | undefined): boolean {
  return mentionsName(ownText(body || ""), name);
}

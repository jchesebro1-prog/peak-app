/**
 * AI daily brief — the text the phone's Listen button reads (spec §4):
 * short sentences, numbers spelled naturally, no symbols read aloud. Fed to
 * `window.speechSynthesis` by the card. Pure, client-safe.
 */
import { chicagoParts } from "@/lib/triage/clock";
import { stripLinksAndTags } from "./sanitize";
import type { Brief } from "./types";

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 0–999 in words ("twenty-one", "three hundred forty-two"); anything else stays digits. */
export function spellNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} hundred${rest ? ` ${spellNumber(rest)}` : ""}`;
}

/** Chicago clock time read aloud: "nine a.m.", "nine thirty a.m.", "two oh five p.m.". */
export function spokenTime(ms: number): string {
  const p = chicagoParts(ms);
  const h12 = p.hour % 12 || 12;
  const ampm = p.hour < 12 ? "a.m." : "p.m.";
  const min = p.minute === 0 ? "" : p.minute < 10 ? ` oh ${spellNumber(p.minute)}` : ` ${spellNumber(p.minute)}`;
  return `${spellNumber(h12)}${min} ${ampm}`;
}

const unit = (count: number, one: string, many: string) => `${spellNumber(count)} ${count === 1 ? one : many}`;

/** Minutes read aloud: "one hour and ten minutes", "twenty-five minutes". */
export function spokenDuration(totalMin: number): string {
  const m = Math.max(0, Math.round(totalMin));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return unit(r, "minute", "minutes");
  return r ? `${unit(h, "hour", "hours")} and ${unit(r, "minute", "minutes")}` : unit(h, "hour", "hours");
}

const cap1 = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const ORDINAL = ["First", "Second", "Third", "Fourth", "Fifth"];

/** Text for the voice: links read as their text, HTML tags and `[ ] < >` vanish, symbols become pauses, markdown marks vanish, every sentence ends with a stop. */
function speakable(raw: string): string {
  const s = stripLinksAndTags(raw)
    .replace(/\s*[·•|]\s*/g, ", ")
    .replace(/[*#_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/^,\s*|,\s*$/g, "");
  if (!s) return "";
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/**
 * The brief as one paragraph of short sentences. `titles` maps a
 * Do-these-first key to its row title (from the snapshot); an item with no
 * title reads its why, and one with neither is skipped — a raw key is never
 * read aloud.
 */
export function briefSpeech(brief: Brief, titles: Readonly<Record<string, string>> = {}): string {
  const out: string[] = [];
  const morning = brief.slot === "morning";
  out.push(morning ? "Good morning. Here is your morning brief." : "Good afternoon. Here is your afternoon brief.");
  if (!morning && brief.since) {
    const s = brief.since;
    out.push(`Since this morning, ${spellNumber(s.done)} done, ${spellNumber(s.open)} still open, and ${s.new ? spellNumber(s.new) : "none"} new.`);
  }
  const summary = speakable(brief.summary);
  if (summary) out.push(summary);

  const items: string[] = [];
  for (const d of brief.doFirst) {
    const title = speakable(titles[d.key] || "");
    const why = speakable(d.why || "");
    if (!title && !why) continue;
    if (items.length >= ORDINAL.length) break;
    items.push(`${ORDINAL[items.length]}, ${title || why}${title && why ? ` ${why}` : ""}`);
  }
  if (items.length) out.push(`Do these first. ${items.join(" ")}`);

  const t = brief.today;
  if (t.visits > 0) {
    out.push(`You have ${unit(t.visits, "site visit", "site visits")} today.`);
    if (t.firstVisitAt) out.push(`${t.visits === 1 ? "It is" : "The first is"} at ${spokenTime(t.firstVisitAt)}`);
  }
  if (t.driveMin && t.driveMin > 0) out.push(`About ${spokenDuration(t.driveMin)} of driving.`);
  if (t.tasksDue > 0) out.push(`${cap1(spellNumber(t.tasksDue))} ${t.tasksDue === 1 ? "task is" : "tasks are"} on today's plan.`);
  if (brief.approvals > 0) out.push(`${cap1(spellNumber(brief.approvals))} ${brief.approvals === 1 ? "quote is" : "quotes are"} waiting on your approval.`);
  if (brief.quiet.length > 0) out.push(`${cap1(spellNumber(brief.quiet.length))} sent ${brief.quiet.length === 1 ? "quote has" : "quotes have"} gone quiet.`);
  const o = brief.organize;
  if (o.toFile > 0) {
    const strong = o.strong > 0 ? `, ${spellNumber(o.strong)} of them strong` : "";
    const noise = o.noise > 0 ? `, and ${spellNumber(o.noise)} noise` : "";
    out.push(`${cap1(unit(o.toFile, "thread", "threads"))} to file${strong}${noise}.`);
  } else if (o.noise > 0) {
    out.push(`${cap1(unit(o.noise, "noise thread", "noise threads"))} in the inbox.`);
  }
  const p = brief.newPromiseTasks.length;
  if (p > 0) out.push(`${cap1(spellNumber(p))} new ${p === 1 ? "task from a promise" : "tasks from promises"}.`);
  return out.join(" ");
}

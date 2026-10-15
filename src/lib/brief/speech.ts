/**
 * AI daily brief — the text the phone's Listen button reads (spec §4):
 * short sentences, numbers spelled naturally, no symbols read aloud. Fed to
 * `window.speechSynthesis` by the card. Pure, client-safe.
 */
import { chicagoParts } from "@/lib/triage/clock";
import type { TriageSource } from "@/lib/triage/types";
import { BRIEF_BLOCK_TITLE, blockOfKey, rowSource, rowsByBlock, type BriefBlockId } from "./blocks";
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

/** "One customer is" / "Three customers are". */
const are = (count: number, one: string, many: string) => `${cap1(spellNumber(count))} ${count === 1 ? `${one} is` : `${many} are`}`;

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

/** A visible snapshot row, as the card has it (only what Listen reads). */
export type SpeechRow = { key: string; source?: unknown; title: string };

/**
 * The brief as one paragraph of short sentences: the greeting, the
 * afternoon's since line, the summary, then the card's three blocks in its
 * order — Emails, Estimates, Tasks (`blocks.ts`). Each block opens with its
 * ★ picks ("Start with …", "Then …": the row title, then the why), then its
 * counts in the card's order; a block with nothing to say is skipped.
 * `rows` are the slot's visible rows (null = the snapshot couldn't be read:
 * the picks are read by their why, and no row counts are given). A pick
 * whose row is gone is skipped, as the card drops it; an item with no title
 * and no why is skipped — a raw key is never read aloud.
 */
export function briefSpeech(brief: Brief, rows: readonly SpeechRow[] | null = null): string {
  const out: string[] = [];
  const morning = brief.slot === "morning";
  out.push(morning ? "Good morning. Here is your morning brief." : "Good afternoon. Here is your afternoon brief.");
  if (!morning && brief.since) {
    const s = brief.since;
    out.push(`Since this morning, ${spellNumber(s.done)} done, ${spellNumber(s.open)} still open, and ${s.new ? spellNumber(s.new) : "none"} new.`);
  }
  const summary = speakable(brief.summary);
  if (summary) out.push(summary);

  const titleOf = new Map((rows ?? []).map((r) => [r.key, r.title]));
  const grouped = rowsByBlock(rows ?? []);
  const count = (id: BriefBlockId, ...sources: TriageSource[]) => grouped[id].filter((r) => sources.includes(rowSource(r)!)).length;

  const picks: Record<BriefBlockId, string[]> = { emails: [], estimates: [], tasks: [] };
  for (const d of brief.doFirst) {
    const block = blockOfKey(d.key);
    if (!block) continue;
    if (rows && !titleOf.has(d.key)) continue;
    const title = speakable(titleOf.get(d.key) || "");
    const why = speakable(d.why || "");
    if (!title && !why) continue;
    picks[block].push(`${picks[block].length ? "Then" : "Start with"} ${title || why}${title && why ? ` ${why}` : ""}`);
  }

  const say = (id: BriefBlockId, lines: string[]) => {
    const all = [...picks[id], ...lines];
    if (all.length) out.push(`${BRIEF_BLOCK_TITLE[id]}. ${all.join(" ")}`);
  };

  // Emails — customers waiting on a reply, then Organize.
  const emails: string[] = [];
  const waiting = count("emails", "email");
  if (waiting > 0) emails.push(`${are(waiting, "customer", "customers")} waiting on a reply.`);
  const o = brief.organize;
  if (o.toFile > 0) {
    const strong = o.strong > 0 ? `, ${spellNumber(o.strong)} of them strong` : "";
    const noise = o.noise > 0 ? `, and ${spellNumber(o.noise)} noise` : "";
    emails.push(`${cap1(unit(o.toFile, "thread", "threads"))} to file${strong}${noise}.`);
  } else if (o.noise > 0) {
    emails.push(`${cap1(unit(o.noise, "noise thread", "noise threads"))} in the inbox.`);
  }
  say("emails", emails);

  // Estimates — approvals, quiet quotes, leads ready to quote, renewals.
  const est: string[] = [];
  if (brief.approvals > 0) est.push(`${are(brief.approvals, "quote", "quotes")} waiting on your approval.`);
  if (brief.quiet.length > 0) est.push(`${cap1(spellNumber(brief.quiet.length))} sent ${brief.quiet.length === 1 ? "quote has" : "quotes have"} gone quiet.`);
  const leads = count("estimates", "lead");
  if (leads > 0) est.push(`${are(leads, "lead", "leads")} ready to quote.`);
  const renewals = count("estimates", "renewal");
  if (renewals > 0) est.push(`${are(renewals, "renewal", "renewals")} coming up.`);
  say("estimates", est);

  // Tasks — the list's tasks, promise-tasks, then today's plan.
  const tasks: string[] = [];
  const onList = count("tasks", "task", "assignment", "call");
  if (onList > 0) tasks.push(`${are(onList, "task", "tasks")} on your list.`);
  const p = brief.newPromiseTasks.length;
  if (p > 0) tasks.push(`${cap1(spellNumber(p))} new ${p === 1 ? "task from a promise" : "tasks from promises"}.`);
  const t = brief.today;
  if (t.visits > 0) {
    tasks.push(`You have ${unit(t.visits, "site visit", "site visits")} today.`);
    if (t.firstVisitAt) tasks.push(`${t.visits === 1 ? "It is" : "The first is"} at ${spokenTime(t.firstVisitAt)}`); // "a.m." / "p.m." ends the sentence
  }
  if (t.driveMin && t.driveMin > 0) tasks.push(`About ${spokenDuration(t.driveMin)} of driving.`);
  if (t.tasksDue > 0) tasks.push(`${cap1(spellNumber(t.tasksDue))} ${t.tasksDue === 1 ? "task is" : "tasks are"} on today's plan.`);
  say("tasks", tasks);
  return out.join(" ");
}

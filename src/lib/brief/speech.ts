/**
 * AI daily brief — the text the phone's Listen button reads (spec §4):
 * short sentences, numbers spelled naturally, no symbols read aloud. Fed to
 * `window.speechSynthesis` by the card. Pure, client-safe.
 */
import { chicagoParts } from "@/lib/triage/clock";
import type { TriageSource } from "@/lib/triage/types";
import { BRIEF_BLOCK_TITLE, rowSource, type BriefBlockId } from "./blocks";
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
 * order — Emails, Estimates, Tasks (`blocks.ts`). Inside each block Listen
 * walks the card's own order (`briefCardVM`): each group's ★ picks ("Start
 * with <title>. <why>", then "Then …") followed by that group's count, so
 * Estimates reads the approvals, the ★ quotes, the quiet quotes, the ★
 * leads and their count, then the ★ renewals and their count. A block with
 * nothing to say is skipped.
 *
 * `rows` are the slot's visible rows. Fail closed (#350 review): with none
 * (null — the snapshot couldn't be read) no picks and no row counts are
 * read, as the card shows none. A pick whose row is gone is skipped, as the
 * card drops it; a raw key is never read aloud.
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

  const list = (rows ?? []).filter((r) => r && typeof r.key === "string" && rowSource(r));
  const titleOf = new Map(list.map((r) => [r.key, r.title]));
  const count = (...sources: TriageSource[]) => list.filter((r) => sources.includes(rowSource(r)!)).length;

  // the picks per source, in the model's order (the card floats them in that order)
  const picksOf = (...sources: TriageSource[]): string[] => {
    const said: string[] = [];
    for (const d of brief.doFirst) {
      if (!titleOf.has(d.key)) continue; // gone, or no rows at all — the card shows neither
      if (!sources.includes(rowSource({ key: d.key })!)) continue;
      const title = speakable(titleOf.get(d.key) || "");
      const why = speakable(d.why || "");
      if (!title && !why) continue;
      said.push(`${title || why}${title && why ? ` ${why}` : ""}`);
    }
    return said;
  };

  /** One block: its parts in card order; picks read "Start with …" / "Then …" across the block. */
  const block = (id: BriefBlockId, parts: Array<{ picks: string[] } | string | null>) => {
    const said: string[] = [];
    let n = 0;
    for (const p of parts) {
      if (!p) continue;
      if (typeof p === "string") said.push(p);
      else for (const pick of p.picks) said.push(`${n++ ? "Then" : "Start with"} ${pick}`);
    }
    if (said.length) out.push(`${BRIEF_BLOCK_TITLE[id]}. ${said.join(" ")}`);
  };

  // Emails — the waiting emails (★ first), then Organize.
  const waiting = count("email");
  const o = brief.organize;
  let organize: string | null = null;
  if (o.toFile > 0) {
    const strong = o.strong > 0 ? `, ${spellNumber(o.strong)} of them strong` : "";
    const noise = o.noise > 0 ? `, and ${spellNumber(o.noise)} noise` : "";
    organize = `${cap1(unit(o.toFile, "thread", "threads"))} to file${strong}${noise}.`;
  } else if (o.noise > 0) {
    organize = `${cap1(unit(o.noise, "noise thread", "noise threads"))} in the inbox.`;
  }
  block("emails", [{ picks: picksOf("email") }, waiting > 0 ? `${are(waiting, "customer", "customers")} waiting on a reply.` : null, organize]);

  // Estimates — the card's order: approvals, the ★ quote rows, quiet quotes, leads, renewals.
  const leads = count("lead");
  const renewals = count("renewal");
  block("estimates", [
    brief.approvals > 0 ? `${are(brief.approvals, "quote", "quotes")} waiting on your approval.` : null,
    { picks: picksOf("quote") },
    brief.quiet.length > 0 ? `${cap1(spellNumber(brief.quiet.length))} sent ${brief.quiet.length === 1 ? "quote has" : "quotes have"} gone quiet.` : null,
    { picks: picksOf("lead") },
    leads > 0 ? `${are(leads, "lead", "leads")} ready to quote.` : null,
    { picks: picksOf("renewal") },
    renewals > 0 ? `${are(renewals, "renewal", "renewals")} coming up.` : null,
  ]);

  // Tasks — the card's order: the list's tasks (★ first), promise-tasks, Today, today's visits.
  const onList = count("task", "assignment", "call");
  const p = brief.newPromiseTasks.length;
  const t = brief.today;
  block("tasks", [
    { picks: picksOf("task", "assignment", "call") },
    onList > 0 ? `${are(onList, "task", "tasks")} on your list.` : null,
    p > 0 ? `${cap1(spellNumber(p))} new ${p === 1 ? "task from a promise" : "tasks from promises"}.` : null,
    t.visits > 0 ? `You have ${unit(t.visits, "site visit", "site visits")} today.` : null,
    t.visits > 0 && t.firstVisitAt ? `${t.visits === 1 ? "It is" : "The first is"} at ${spokenTime(t.firstVisitAt)}` : null, // "a.m." / "p.m." ends the sentence
    t.driveMin && t.driveMin > 0 ? `About ${spokenDuration(t.driveMin)} of driving.` : null,
    t.tasksDue > 0 ? `${cap1(spellNumber(t.tasksDue))} ${t.tasksDue === 1 ? "task is" : "tasks are"} on today's plan.` : null,
    { picks: picksOf("visit") },
  ]);
  return out.join(" ");
}

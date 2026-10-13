/** AI daily brief checks (spec 2026-10-13-ai-brief-design.md). Standalone: `npm run test:brief`; also chained into test:specs. */
import { readFileSync } from "node:fs";
import { MIDDAY_AT_MIN, MORNING_AT_MIN, slotAt } from "@/lib/triage/clock";
import { BRIEF_TIMES, briefId, briefSlotAt, briefTitle, prevDayKey, previousBriefSlot } from "@/lib/brief/slots";
import { BRIEF_SUMMARY_MAX, BRIEF_WHY_MAX, BriefSchema, cleanBriefText, sanitizeBrief } from "@/lib/brief/sanitize";
import { ruleBrief, type BriefFacts } from "@/lib/brief/fallback";
import { sinceMorning } from "@/lib/brief/diff";
import { QUIET_BUSINESS_DAYS, QUIET_MAX, selectQuietQuotes, type QuietQuoteInput, type QuietThreadInput } from "@/lib/brief/quiet";
import { briefSpeech, spellNumber, spokenDuration, spokenTime } from "@/lib/brief/speech";
import { lastSentAt, newestInboundId, nudgeFresh, preDraftFresh } from "@/lib/brief/fresh";
import type { Brief } from "@/lib/brief/types";
import type { QuoteHistoryEntry } from "@/lib/stores/quotes";
import { ASSIST_FEATURES, OPT_IN_FEATURES, assistSettingsOf } from "@/lib/assist/config";
import { RATE_LIMITS, toJsonSchema } from "@/lib/assist/run";
import { SLOT_SETTINGS, modelFor } from "@/lib/assist/models";
import { featureKey } from "@/lib/assist/report";
import type { Ok } from "./test-inbox-org";

const H = 3_600_000;
const D = 86_400_000;
/** Mon 12 Oct 2026, CDT (UTC−5). */
const cdt = (day: number, h: number, m = 0) => Date.UTC(2026, 9, day, h + 5, m);
const MON = (h: number, m = 0) => cdt(12, h, m);

function slotChecks(ok: Ok): void {
  ok(MIDDAY_AT_MIN === 13 * 60 + 45 && MORNING_AT_MIN === 6 * 60 + 45, "brief slots: the clock's boundaries are 6:45 and 13:45");
  ok(slotAt(MON(13, 44)).slot === "morning" && slotAt(MON(13, 45)).slot === "midday", "brief slots: 13:44 Chicago is morning, 13:45 is midday (minute-precise)");
  ok(slotAt(MON(0, 1)).slot === "morning" && slotAt(MON(6, 0)).slot === "morning" && slotAt(MON(12, 0)).slot === "morning", "brief slots: anything before 13:45 — midnight, 6:00, noon — is the same day's morning slot");
  ok(slotAt(MON(23, 59)).slot === "midday" && slotAt(MON(23, 59)).day === "2026-10-12", "brief slots: 23:59 is still that day's midday");
  // CST (UTC−6): Mon 7 Dec 2026
  const cst = (h: number, m: number) => Date.UTC(2026, 11, 7, h + 6, m);
  ok(slotAt(cst(13, 44)).slot === "morning" && slotAt(cst(13, 45)).slot === "midday", "brief slots: the 13:45 boundary holds in CST too");
  ok(BRIEF_TIMES.morning.hour === 6 && BRIEF_TIMES.morning.minute === 45 && BRIEF_TIMES.midday.hour === 13 && BRIEF_TIMES.midday.minute === 45, "brief slots: BRIEF_TIMES are 06:45 and 13:45");
  ok(briefId("u3", "2026-10-12", "midday") === "brief:u3:2026-10-12:midday", "brief slots: blob id is brief:<userId>:<day>:<slot>");
  ok(briefTitle("morning") === "Morning brief · 6:45" && briefTitle("midday") === "Afternoon brief · 1:45", "brief slots: card titles");
  const early = briefSlotAt(MON(6, 44));
  const on = briefSlotAt(MON(6, 45));
  ok(early.slot === "morning" && early.beforeMorning && !on.beforeMorning && on.day === "2026-10-12", "brief slots: before 6:45 is flagged beforeMorning; 6:45 on is not");
  ok(prevDayKey("2026-11-01") === "2026-10-31" && prevDayKey("2027-01-01") === "2026-12-31" && prevDayKey("2024-03-01") === "2024-02-29", "brief slots: prevDayKey rolls months, years and leap days");
  const p1 = previousBriefSlot("2026-10-12", "midday");
  const p2 = previousBriefSlot("2026-10-12", "morning");
  ok(p1.day === "2026-10-12" && p1.slot === "morning" && p2.day === "2026-10-11" && p2.slot === "midday", "brief slots: the previous brief of midday is that morning; of morning, yesterday's midday");

  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
  ok(vercel.crons.some((c) => c.path === "/api/gmail/sync" && c.schedule === "45 11 * * *"), "brief crons: Gmail sync (morning list + briefs) runs at 11:45 UTC = 6:45 CDT");
  ok(vercel.crons.some((c) => c.path === "/api/triage/build?slot=midday" && c.schedule === "45 18 * * *"), "brief crons: the midday triage build runs at 18:45 UTC = 13:45 CDT");
}

const ROWS = ["email:a", "task:b", "lead:c", "visit:d", "quote:e", "call:f"];
const REASONS: Record<string, string> = { "email:a": "Customer waiting 2 days", "task:b": "Overdue 1 day", "lead:c": "SLA breached", "visit:d": "Visit today", "quote:e": "Awaiting your approval", "call:f": "Call to-do" };

function sanitizeChecks(ok: Ok): void {
  const js = toJsonSchema(BriefSchema) as { type?: string; properties?: Record<string, unknown>; additionalProperties?: unknown };
  ok(js.type === "object" && !!js.properties?.summary && !!js.properties?.doFirst && js.additionalProperties === false, "brief sanitize: BriefSchema is a strict {summary, doFirst} object");
  ok(sanitizeBrief({ nope: 1 }, ROWS) === null && sanitizeBrief("text", ROWS) === null && sanitizeBrief(null, ROWS) === null, "brief sanitize: a shape that fails the schema → null (fallback)");
  ok(sanitizeBrief({ summary: "   ", doFirst: [] }, ROWS) === null, "brief sanitize: an empty summary → null (fallback)");

  const s = sanitizeBrief(
    {
      summary: "  **Busy day.**\n\n## Start with Pat\n- reply to Pat  ",
      doFirst: [
        { key: "lead:c", why: "  SLA breached  " },
        { key: "made:up", why: "hallucinated" },
        { key: "lead:c", why: "duplicate" },
        { key: "email:a", why: "x".repeat(400) },
        { key: "task:b", why: "overdue" },
        { key: "visit:d", why: "today" },
        { key: "quote:e", why: "approval" },
        { key: "call:f", why: "sixth" },
      ],
    },
    ROWS,
    REASONS
  )!;
  ok(!!s && s.doFirst.map((d) => d.key).join(",") === "lead:c,email:a,task:b,visit:d,quote:e", "brief sanitize: keeps only snapshot keys, drops duplicates, caps at 5 in the model's order");
  ok(s.doFirst[0].why === "SLA breached" && s.doFirst[1].why.length <= BRIEF_WHY_MAX && s.doFirst[1].why.endsWith("…"), "brief sanitize: why is trimmed and capped");
  ok(s.summary === "Busy day. Start with Pat reply to Pat", `brief sanitize: summary is plain text, markdown stripped, whitespace collapsed (${JSON.stringify(s.summary)})`);

  const padded = sanitizeBrief({ summary: "Short day.", doFirst: [{ key: "task:b", why: "go" }, { key: "nope", why: "x" }] }, ROWS, REASONS)!;
  ok(padded.doFirst.map((d) => d.key).join(",") === "task:b,email:a,lead:c" && padded.doFirst[1].why === "Customer waiting 2 days", "brief sanitize: fewer than 3 valid keys are padded from the top snapshot rows with their reasons");
  const tiny = sanitizeBrief({ summary: "One thing.", doFirst: [] }, ["email:a"])!;
  ok(tiny.doFirst.length === 1 && tiny.doFirst[0].key === "email:a" && tiny.doFirst[0].why === "", "brief sanitize: a 1-row snapshot pads to 1; a missing reason is blank");
  ok(sanitizeBrief({ summary: "Clear.", doFirst: [{ key: "email:a", why: "x" }] }, [])!.doFirst.length === 0, "brief sanitize: an empty snapshot keeps no keys");

  const long = sanitizeBrief({ summary: "word ".repeat(400), doFirst: [] }, ROWS)!;
  ok(long.summary.length <= BRIEF_SUMMARY_MAX && long.summary.endsWith("…") && !/\s…$/.test(long.summary), "brief sanitize: summary capped at 900 chars on a word boundary");
  ok(cleanBriefText("a\u0000b\u0007c <b>x</b>", 50) === "abc <b>x</b>", "brief sanitize: control characters stripped (React escapes the rest)");
}

const ROW_OBJS = ROWS.map((key, i) => ({ key, title: `Item ${i + 1}`, reason: REASONS[key] }));
function facts(over: Partial<BriefFacts> = {}): BriefFacts {
  return {
    slot: "morning",
    rows: ROW_OBJS,
    organize: { toFile: 5, strong: 2, noise: 3 },
    newPromiseTasks: [{ taskId: "T-prm-1", title: "Send drawings", due: null }],
    today: { visits: 2, firstVisitAt: MON(9, 30), driveMin: 70, tasksDue: 3 },
    quiet: [],
    approvals: 2,
    ...over,
  };
}

function fallbackChecks(ok: Ok): void {
  const r = ruleBrief(facts());
  ok(r.doFirst.map((d) => d.key).join(",") === "email:a,task:b,lead:c" && r.doFirst[0].why === "Customer waiting 2 days", "brief fallback: doFirst is the top 3 snapshot rows with their reasons");
  ok(
    r.summary.includes("6 items on your list") && r.summary.includes("2 site visits today, the first at 9:30 AM") && r.summary.includes("1 h 10 min of driving") && r.summary.includes("3 tasks due today") && r.summary.includes("2 quotes waiting on your approval") && r.summary.includes("5 threads to file (2 strong)") && r.summary.includes("3 noise") && r.summary.includes("1 new task from a promise"),
    `brief fallback: summary is composed from the counts (${r.summary})`
  );
  const quiet = [{ quoteId: "Q-1", number: "EST-1001", name: "Stage", customer: "North HS", sentAt: MON(9), days: 6 }];
  const clear = ruleBrief(facts({ rows: [], organize: { toFile: 0, strong: 0, noise: 0 }, newPromiseTasks: [], today: { visits: 0, firstVisitAt: null, driveMin: null, tasksDue: 0 }, approvals: 0, quiet }));
  ok(clear.doFirst.length === 0 && clear.summary.includes("Your list is clear") && clear.summary.includes("1 sent quote has gone quiet") && !/visit|approval|to file|promise/.test(clear.summary), `brief fallback: zero counts are left out; singular wording (${clear.summary})`);
  const one = ruleBrief(facts({ rows: ROW_OBJS.slice(0, 1), today: { visits: 1, firstVisitAt: MON(14), driveMin: 25, tasksDue: 1 } }));
  ok(one.summary.includes("1 item on your list") && one.summary.includes("1 site visit today, at 2:00 PM") && one.summary.includes("25 min of driving") && one.summary.includes("1 task due today"), `brief fallback: singular counts (${one.summary})`);
  const pm = ruleBrief(facts({ slot: "midday", since: { done: 4, open: 2, new: 1 } }));
  ok(pm.summary.startsWith("Since this morning: 4 done, 2 still open, 1 new."), `brief fallback: the afternoon summary leads with the since-morning line (${pm.summary.slice(0, 60)})`);
  ok(ruleBrief(facts({ rows: Array.from({ length: 400 }, (_, i) => ({ key: `k${i}`, title: "t", reason: "r" })) })).summary.length <= BRIEF_SUMMARY_MAX, "brief fallback: summary within the cap");
}

function diffChecks(ok: Ok): void {
  const morning = { builtAt: MON(6, 45), doFirst: [{ key: "a", why: "" }, { key: "z", why: "" }], snapshotKeys: ["a", "b", "c", "d", "e"] };
  const marks = [
    { key: "b", kind: "done" as const, at: MON(9) },
    { key: "c", kind: "snooze" as const, at: MON(9) },
    { key: "e", kind: "done" as const, at: MON(5) }, // before the morning brief — ignored
  ];
  // current: a still open, b came back after done (counts done), d gone (resolved), e still open, f new
  const s = sinceMorning(morning, ["a", "b", "e", "f"], marks);
  ok(s.done === 3 && s.open === 2 && s.new === 1, `brief diff: done = marked done or resolved (b, d, z), open = still listed (a, e), new = not on the morning list (f) — got ${JSON.stringify(s)}`);
  const d2 = sinceMorning({ builtAt: MON(6, 45), doFirst: [], snapshotKeys: ["a", "c"] }, ["a"], [{ key: "c", kind: "dismiss", at: MON(8) }]);
  ok(d2.done === 0 && d2.open === 1 && d2.new === 0, "brief diff: a snoozed or dismissed row is neither done nor open");
  const d3 = sinceMorning({ builtAt: MON(6, 45), doFirst: [{ key: "x", why: "" }] }, ["x", "y"], []);
  ok(d3.open === 1 && d3.new === 1 && d3.done === 0, "brief diff: without morning snapshot keys, the doFirst keys are the base");
}

function quote(over: Partial<QuietQuoteInput> & { id: string }): QuietQuoteInput {
  return { name: "Stage curtain", customer: "North HS", customerId: "C-1", status: "sent", owner: "Dana Tester", preparedBy: "", estNo: 1001, quoteType: "system", history: [{ at: cdt(5, 10), from: "draft", to: "sent" }], ...over };
}
function thread(over: Partial<QuietThreadInput>): QuietThreadInput {
  return { customerId: null, subject: "", link: null, messages: [], ...over };
}

function quietChecks(ok: Ok): void {
  const me = { name: "dana tester " };
  const now = MON(10);
  const base = quote({ id: "Q-1" });
  const r1 = selectQuietQuotes([base], [], me, now);
  ok(QUIET_BUSINESS_DAYS === 5 && QUIET_MAX === 8, "brief quiet: 5 business days, at most 8");
  ok(r1.length === 1 && r1[0].quoteId === "Q-1" && r1[0].number === "EST-1001" && r1[0].days === 5 && r1[0].sentAt === cdt(5, 10) && r1[0].customer === "North HS", "brief quiet: a quote sent 5 business days ago with no reply is quiet (owner matched trimmed, case-insensitive)");
  ok(selectQuietQuotes([quote({ id: "Q-2", history: [{ at: cdt(6, 10), to: "sent" }] })], [], me, now).length === 0, "brief quiet: 4 business days is not quiet yet");
  ok(selectQuietQuotes([quote({ id: "Q-3", history: [{ at: cdt(2, 16), to: "sent" }] })], [], me, MON(9)).length === 1 && selectQuietQuotes([quote({ id: "Q-3b", history: [{ at: cdt(5, 16), to: "sent" }] })], [], me, cdt(10, 16)).length === 0, "brief quiet: weekends don't count (Fri 4 pm → Mon-week-later 9 am is 5 business days; Mon 4 pm → Sat 4 pm is 4)");
  ok(selectQuietQuotes([quote({ id: "Q-4", status: "won" })], [], me, now).length === 0 && selectQuietQuotes([quote({ id: "Q-5", status: "draft", history: [{ at: cdt(1, 9), to: "sent" }, { at: cdt(2, 9), from: "sent", to: "draft" }] })], [], me, now).length === 0, "brief quiet: only status sent counts");
  ok(selectQuietQuotes([quote({ id: "Q-6", history: [{ at: cdt(1, 9), to: "sent" }, { at: cdt(2, 9), from: "sent", to: "won" }] })], [], me, now).length === 0, "brief quiet: the last history entry must be → sent");
  ok(selectQuietQuotes([quote({ id: "Q-7", history: [] })], [], me, now).length === 0, "brief quiet: no history → not quiet");
  ok(selectQuietQuotes([quote({ id: "Q-8", owner: "Ari Other" })], [], me, now).length === 0, "brief quiet: someone else's quote is not mine");
  ok(selectQuietQuotes([quote({ id: "Q-9", owner: "", preparedBy: "Dana Tester" })], [], me, now).length === 1, "brief quiet: preparedBy counts when there is no owner");
  ok(selectQuietQuotes([quote({ id: "Q-9b", owner: "Ari Other", preparedBy: "Dana Tester" })], [], me, now).length === 0, "brief quiet: an owner other than me wins over preparedBy (one person follows up)");

  const sentAt = cdt(5, 10);
  const linked = thread({ link: { type: "quote", id: "Q-1" }, messages: [{ direction: "in", at: sentAt + D }] });
  ok(selectQuietQuotes([base], [linked], me, now).length === 0, "brief quiet: an inbound message after the send on a thread linked to the quote → not quiet");
  ok(selectQuietQuotes([base], [thread({ link: { type: "quote", id: "Q-1" }, messages: [{ direction: "in", at: sentAt - H }, { direction: "out", at: sentAt + D }] })], me, now).length === 1, "brief quiet: inbound before the send, or our own outbound after, keep it quiet");
  ok(selectQuietQuotes([base], [thread({ link: { type: "quote", id: "Q-OTHER" }, messages: [{ direction: "in", at: sentAt + D }] })], me, now).length === 1, "brief quiet: a reply linked to a different quote doesn't count");
  ok(selectQuietQuotes([base], [thread({ customerId: "C-1", subject: "RE: est-1001 pricing", messages: [{ direction: "in", at: sentAt + D }] })], me, now).length === 0, "brief quiet: a customer thread whose subject names the estimate number (case-insensitive) counts");
  ok(selectQuietQuotes([base], [thread({ customerId: "C-2", subject: "RE: EST-1001", messages: [{ direction: "in", at: sentAt + D }] })], me, now).length === 1, "brief quiet: the same subject on another customer's thread doesn't count");
  ok(selectQuietQuotes([base], [thread({ customerId: "C-1", subject: "RE: EST-10012", messages: [{ direction: "in", at: sentAt + D }] })], me, now).length === 1, "brief quiet: EST-10012 is not EST-1001 (whole-number match)");
  ok(selectQuietQuotes([quote({ id: "Q-1", customerId: null })], [thread({ customerId: null, subject: "EST-1001", messages: [{ direction: "in", at: sentAt + D }] })], me, now).length === 1, "brief quiet: no customer link → only linked threads count");

  const many = Array.from({ length: 10 }, (_, i) => quote({ id: `Q-m${i}`, estNo: 2000 + i, history: [{ at: cdt(1, 9) - i * D, to: "sent" }] }));
  const r2 = selectQuietQuotes(many, [], me, now);
  ok(r2.length === 8 && r2[0].quoteId === "Q-m9" && r2[7].quoteId === "Q-m2", "brief quiet: at most 8, oldest sent first");
  ok(selectQuietQuotes([quote({ id: "Q-n", estNo: null })], [], me, now)[0]?.number === "Q-n", "brief quiet: a quote without an estimate number shows its id");
}

const BRIEF: Brief = {
  userId: "u1",
  day: "2026-10-12",
  slot: "morning",
  builtAt: MON(6, 45),
  builtBy: "cron",
  summary: "Busy Monday · two visits.",
  doFirst: [{ key: "email:a", why: "Pat has waited 2 days" }, { key: "task:b", why: "" }],
  organize: { toFile: 5, strong: 2, noise: 3 },
  newPromiseTasks: [{ taskId: "T-prm-1", title: "Send drawings", due: null }],
  today: { visits: 2, firstVisitAt: MON(9, 30), driveMin: 70, tasksDue: 3 },
  quiet: [{ quoteId: "Q-1", number: "EST-1001", name: "Stage", customer: "North HS", sentAt: MON(9), days: 6 }],
  approvals: 1,
  runId: "AR-1",
};

function speechChecks(ok: Ok): void {
  ok(spellNumber(0) === "zero" && spellNumber(7) === "seven" && spellNumber(13) === "thirteen" && spellNumber(21) === "twenty-one" && spellNumber(40) === "forty" && spellNumber(99) === "ninety-nine", "brief speech: small numbers spelled out");
  ok(spellNumber(100) === "one hundred" && spellNumber(342) === "three hundred forty-two" && spellNumber(1500) === "1500", "brief speech: hundreds spelled; larger numbers stay digits");
  ok(spokenTime(MON(9)) === "nine a.m." && spokenTime(MON(9, 30)) === "nine thirty a.m." && spokenTime(MON(14, 5)) === "two oh five p.m." && spokenTime(MON(12, 15)) === "twelve fifteen p.m.", "brief speech: Chicago times read naturally");
  ok(spokenDuration(70) === "one hour and ten minutes" && spokenDuration(60) === "one hour" && spokenDuration(25) === "twenty-five minutes" && spokenDuration(1) === "one minute" && spokenDuration(125) === "two hours and five minutes", "brief speech: durations read naturally");

  const titles = { "email:a": "Reply to Pat at North HS" };
  const s = briefSpeech(BRIEF, titles);
  ok(s.startsWith("Good morning. Here is your morning brief."), `brief speech: opens with the greeting (${s.slice(0, 50)})`);
  ok(s.includes("Busy Monday, two visits.") && !s.includes("·"), "brief speech: the summary is read with symbols turned into pauses");
  ok(s.includes("Do these first. First, Reply to Pat at North HS. Pat has waited 2 days."), "brief speech: Do these first reads the row title, then why");
  ok(!s.includes("task:b"), "brief speech: an item with no title and no why is never read as a raw key");
  ok(s.includes("You have two site visits today. The first is at nine thirty a.m.") && s.includes("About one hour and ten minutes of driving.") && s.includes("Three tasks are due today."), "brief speech: today read with spelled numbers");
  ok(s.includes("One quote is waiting on your approval.") && s.includes("One sent quote has gone quiet.") && s.includes("Five threads to file, two of them strong, and three noise.") && s.includes("One new task from a promise."), "brief speech: counts read with singular/plural wording");
  const pm = briefSpeech({ ...BRIEF, slot: "midday", since: { done: 4, open: 1, new: 0 }, organize: { toFile: 0, strong: 0, noise: 0 }, quiet: [], approvals: 0, newPromiseTasks: [], today: { visits: 0, firstVisitAt: null, driveMin: null, tasksDue: 0 } });
  ok(pm.startsWith("Good afternoon. Here is your afternoon brief.") && pm.includes("Since this morning, four done, one still open, and none new.") && !/site visit|approval|quiet|to file|promise|due today/.test(pm), `brief speech: afternoon reads the since line; zero counts are skipped (${pm})`);
  ok(!/[*#_`]/.test(briefSpeech({ ...BRIEF, summary: "**Bold** _x_ `y` # z" })), "brief speech: no markdown symbols are read aloud");
}

function freshChecks(ok: Ok): void {
  const msgs = [
    { id: "m1", direction: "in" as const, at: 100 },
    { id: "m2", direction: "out" as const, at: 300 },
    { id: "m3", direction: "in" as const, at: 200 },
  ];
  ok(newestInboundId({ messages: msgs }) === "m3" && newestInboundId({ messages: [{ id: "o", direction: "out", at: 1 }] }) === null, "brief fresh: the newest inbound message id (by time); none → null");
  ok(preDraftFresh({ messages: msgs, preDraft: { basis: "m3" } }), "brief fresh: a pre-draft based on the newest inbound message is fresh");
  ok(!preDraftFresh({ messages: [...msgs, { id: "m4", direction: "in", at: 400 }], preDraft: { basis: "m3" } }), "brief fresh: a newer inbound message makes it stale");
  ok(preDraftFresh({ messages: [...msgs, { id: "m5", direction: "out", at: 500 }], preDraft: { basis: "m3" } }), "brief fresh: our own reply alone doesn't make it stale");
  ok(!preDraftFresh({ messages: msgs, preDraft: null }) && !preDraftFresh({ messages: msgs }) && !preDraftFresh({ messages: [], preDraft: { basis: "" } }), "brief fresh: no pre-draft, or no inbound message, is not fresh");

  type H = QuoteHistoryEntry;
  const q = { status: "sent", history: [{ at: 10, to: "draft" }, { at: 50, from: "draft", to: "sent" }] as H[] };
  ok(lastSentAt(q) === 50 && lastSentAt({ history: [{ at: 50, to: "sent" }, { at: 60, from: "sent", to: "won" }] as H[] }) === null && lastSentAt({ history: [] }) === null, "brief fresh: lastSentAt is the final history entry → sent");
  ok(nudgeFresh({ ...q, assistNudge: { basis: 50 } }) && !nudgeFresh({ ...q, assistNudge: { basis: 40 } }) && !nudgeFresh({ ...q, assistNudge: null }) && !nudgeFresh(q), "brief fresh: a nudge is fresh only for the current send");
  ok(!nudgeFresh({ status: "won", history: [{ at: 50, to: "sent" }] as H[], assistNudge: { basis: 50 } }), "brief fresh: a nudge on a quote that is no longer sent is stale");
}

function featureChecks(ok: Ok): void {
  ok(ASSIST_FEATURES.includes("brief") && OPT_IN_FEATURES.has("brief"), "brief feature: brief is an Assist feature and opt-in");
  ok(assistSettingsOf({}).features.brief === false && assistSettingsOf({ assistFeatures: { brief: "yes" } }).features.brief === false && assistSettingsOf({ assistFeatures: { brief: true } }).features.brief === true, "brief feature: off by default, on only when literally true");
  ok(RATE_LIMITS.brief > 0, "brief feature: has a per-hour rate limit");
  ok(modelFor("brief", {}) === "claude-haiku-5-5" && modelFor("brief", { ASSIST_MODEL_BRIEF: " m-b " }) === "m-b", "brief feature: Haiku slot, overridable by ASSIST_MODEL_BRIEF");
  const st = SLOT_SETTINGS.brief;
  ok(st.effort === "low" && st.maxTokens === 2000 && st.timeoutMs === 30_000 && st.maxRetries === 0 && !st.stream, "brief feature: low effort, 2000 tokens, 30 s, no retries, no stream");
  ok(featureKey({ feature: "brief", step: null }) === "Daily brief", "brief feature: report label is Daily brief");
  const pilot = readFileSync("src/app/(app)/settings/groups/assist-pilot.tsx", "utf8");
  ok(/\{ key: "brief", label: "Daily brief" \}/.test(pilot), "brief feature: the pilot card has a Daily brief switch");
  const act = readFileSync("src/app/(app)/settings/actions.ts", "utf8");
  ok(/"promise" \| "brief", boolean/.test(act) && /brief: typeof patch\.features\.brief === "boolean" \? patch\.features\.brief : cur\.brief/.test(act), "brief feature: setAssistSettingsAction accepts and writes brief");
  const settings = readFileSync("src/lib/settings.ts", "utf8");
  ok(/assistFeatures\?: \{[^}]*brief\?: boolean/.test(settings), "brief feature: the settings type carries assistFeatures.brief");
}

export async function briefPureChecks(ok: Ok): Promise<void> {
  slotChecks(ok);
  sanitizeChecks(ok);
  fallbackChecks(ok);
  diffChecks(ok);
  quietChecks(ok);
  speechChecks(ok);
  freshChecks(ok);
  featureChecks(ok);
  // pure modules stay client-safe: no store / db / server imports
  for (const f of ["types", "slots", "sanitize", "fallback", "diff", "quiet", "speech", "fresh"]) {
    const src = readFileSync(`src/lib/brief/${f}.ts`, "utf8");
    const bad = [...src.matchAll(/^import (?!type )[^;]*from "([^"]+)";/gm)].map((m) => m[1]).filter((p) => /stores\/|@\/db|server|next\/|session/.test(p));
    ok(bad.length === 0, `brief purity: src/lib/brief/${f}.ts imports no store/db/server module${bad.length ? ` (${bad.join(", ")})` : ""}`);
  }
}

if (process.argv[1] && /test-brief\.ts$/.test(process.argv[1])) {
  let fail = 0;
  const ok: Ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  if (process.env.DATABASE_URL) {
    console.error("Refusing to run: DATABASE_URL is set; unset it (this suite writes to the DB).");
    process.exit(1);
  }
  (async () => {
    await briefPureChecks(ok);
    // later tasks append: await briefXChecks(ok);
    console.log(fail ? `\n${fail} FAILED` : "\nall brief checks passed");
    process.exit(fail ? 1 : 0);
  })().catch((err) => {
    console.log("FAIL " + (err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  });
}

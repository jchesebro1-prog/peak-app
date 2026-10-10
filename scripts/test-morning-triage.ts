/**
 * Morning triage — spec checks (docs/superpowers/specs/2026-10-09-morning-triage-design.md).
 *
 * Chained from scripts/test-review-and-spec.ts; every export takes the
 * harness's `ok` so PASS/FAIL counting stays in one place. It only ever runs
 * inside `npm run test:specs` (a scratch PGlite datadir) — never import it
 * from anywhere else. DB rows it writes use fixtureId("TRIAGE", …) ids and are
 * registered for the harness teardown.
 */
import { readFileSync, readdirSync } from "node:fs";
import { DOC_TABLES, SYNCABLE_COLLECTIONS } from "@/db/doc-tables";
import { CONFIG_COLLECTIONS, DEMO_COLLECTIONS } from "@/db/seed-data";
import {
  businessDaysBetween,
  businessMsBetween,
  chicagoMidnight,
  chicagoShortDate,
  chicagoTime,
  dayDiff,
  dayKey,
  nextDayKey,
  nextMorning,
  slotAt,
  slotOrdinal,
  snapshotId,
} from "@/lib/triage/clock";
import { normalizedTitle, tokens } from "@/lib/triage/text";
import { parseTriageKey, triageKey } from "@/lib/triage/keys";
import { factLabel, pointsFor, rankCandidates, reasonOf, scoreOf } from "@/lib/triage/rank";
import { feedErrorMessage, type TriageCandidate, type TriageFact } from "@/lib/triage/types";
import { clipLine, formatTimestamp, matchTranscriptLine } from "@/lib/triage/transcript-match";
import { collapseDuplicates } from "@/lib/triage/dedupe";
import { selectEmail, type DealIndex } from "@/lib/triage/feeds/email";
import { selectTasks, tierOf } from "@/lib/triage/feeds/tasks";
import { selectLeads } from "@/lib/triage/feeds/leads";
import { selectVisits, todaysVisitsFor, visitAttendees } from "@/lib/triage/feeds/visits";
import { selectQuotes } from "@/lib/triage/feeds/quotes";
import { selectRenewals } from "@/lib/triage/feeds/renewals";
import { CALL_WINDOW_MS, recordingTodos, selectCalls } from "@/lib/triage/feeds/calls";
import { FEEDS } from "@/lib/triage/feeds";
import { normalizeRecording, type RecordingRecord } from "@/lib/stores/recordings";
import type { SiteVisit } from "@/lib/stores/site-visits";
import type { Quote } from "@/lib/stores/quotes";
import type { CommThread } from "@/lib/stores/comms";
import { normalizeTask, type TaskRecord } from "@/lib/stores/tasks";
import type { Assignment } from "@/lib/stores/assignments";
import type { LeadRecord } from "@/lib/stores/leads";

export type Ok = (cond: boolean, msg: string) => void;

export const H = 3_600_000;
export const D = 86_400_000;
/** Mon 12 Oct 2026 10:00 CDT (UTC−5). */
export const MON_10 = Date.UTC(2026, 9, 12, 15, 0);
/** Mon 12 Oct 2026 12:00 CDT — the midday boundary. */
export const MON_12 = Date.UTC(2026, 9, 12, 17, 0);
/** Tue 13 Oct 2026 08:00 CDT. */
export const TUE_8 = Date.UTC(2026, 9, 13, 13, 0);
/** Thu 8 Oct 09:00, Fri 9 Oct 09:00 / 15:00, Sat 10 Oct 12:00 — all CDT. */
export const THU_9 = Date.UTC(2026, 9, 8, 14, 0);
export const FRI_9 = Date.UTC(2026, 9, 9, 14, 0);
export const FRI_15 = Date.UTC(2026, 9, 9, 20, 0);
export const SAT_12 = Date.UTC(2026, 9, 10, 17, 0);

export const ME = { id: "u-tri", name: "Dana Tester", canApprove: false };

export async function triageFoundationChecks(ok: Ok): Promise<void> {
  /* ---- wiring ---- */
  ok("triage_snapshots" in DOC_TABLES && "triage_marks" in DOC_TABLES, "triage wiring: both collections are registered doc tables");
  ok(
    !SYNCABLE_COLLECTIONS.includes("triage_snapshots" as never) && !SYNCABLE_COLLECTIONS.includes("triage_marks" as never),
    "triage wiring: neither collection is writable through /api/sync/push"
  );
  ok(
    DEMO_COLLECTIONS.includes("triage_snapshots" as never) &&
      DEMO_COLLECTIONS.includes("triage_marks" as never) &&
      !CONFIG_COLLECTIONS.includes("triage_marks" as never),
    "triage wiring: the go-live reset wipes both (derived, per-user state)"
  );
  const migFile = readdirSync("drizzle").find((f) => /^\d{4}_triage\.sql$/.test(f));
  const mig = migFile ? readFileSync(`drizzle/${migFile}`, "utf8") : "";
  for (const t of ["triage_snapshots", "triage_marks"]) {
    ok(
      new RegExp(`CREATE TABLE IF NOT EXISTS "${t}"`).test(mig) &&
        mig.includes(`${t}_seq_bump`) &&
        mig.includes(`CREATE INDEX IF NOT EXISTS "${t}_seq_idx"`),
      `triage wiring: the migration creates ${t} idempotently with its seq-bump trigger`
    );
  }
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
  ok(!!migFile && journal.entries.some((e) => e.tag === migFile.replace(/\.sql$/, "")), "triage wiring: the journal lists the triage migration");

  /* ---- clock ---- */
  ok(dayKey(MON_10) === "2026-10-12" && dayKey(Date.UTC(2026, 9, 13, 4, 30)) === "2026-10-12", "clock: dayKey is the Chicago calendar day (23:30 CDT stays Monday)");
  ok(nextDayKey("2026-10-31") === "2026-11-01" && nextDayKey("2026-12-31") === "2027-01-01", "clock: nextDayKey rolls months and years");
  ok(dayDiff("2026-10-09", "2026-10-12") === 3 && dayDiff("2026-10-12", "2026-10-12") === 0, "clock: dayDiff counts calendar days");
  ok(
    chicagoMidnight(MON_10) === Date.UTC(2026, 9, 12, 5) &&
      chicagoMidnight(Date.UTC(2026, 10, 2, 18)) === Date.UTC(2026, 10, 2, 6) &&
      chicagoMidnight(Date.UTC(2026, 10, 1, 20)) === Date.UTC(2026, 10, 1, 5),
    "clock: chicagoMidnight is right on CDT, CST and the fall-back day"
  );

  /* ---- business time ---- */
  ok(businessMsBetween(FRI_15, MON_10) === 19 * H && businessDaysBetween(FRI_15, MON_10) === 0, "business time: Fri 3 pm → Mon 10 am is 19 business hours — under one business day (weekend excluded)");
  ok(businessDaysBetween(FRI_9, MON_10) === 1, "business time: Fri 9 am → Mon 10 am is 1 business day");
  ok(businessDaysBetween(THU_9, MON_10) === 2, "business time: Thu 9 am → Mon 10 am is 2 business days");
  ok(businessMsBetween(SAT_12, MON_10) === 10 * H, "business time: a Saturday message only starts counting Monday");
  ok(businessMsBetween(Date.UTC(2026, 9, 30, 5), Date.UTC(2026, 10, 2, 6)) === 24 * H, "business time: Fri → Mon across the DST fall-back counts exactly Friday");
  ok(businessMsBetween(MON_10, FRI_9) === 0, "business time: a reversed range is zero");

  /* ---- slots ---- */
  const lateMon = Date.UTC(2026, 9, 13, 4, 30);
  ok(
    slotAt(MON_10).slot === "morning" && slotAt(MON_12).slot === "midday" && slotAt(lateMon).slot === "midday" && slotAt(lateMon).day === "2026-10-12",
    "slots: before noon Chicago is the morning list, noon on is midday"
  );
  ok(snapshotId("u3", "2026-10-12", "midday") === "u3:2026-10-12:midday", "slots: snapshot key is <userId>:<YYYY-MM-DD>:<slot>");
  ok(
    slotOrdinal("2026-10-12", "morning") < slotOrdinal("2026-10-12", "midday") && slotOrdinal("2026-10-12", "midday") < slotOrdinal("2026-10-13", "morning"),
    "slots: ordinals sort morning < midday < next morning"
  );
  ok(nextMorning("2026-10-12").day === "2026-10-13" && nextMorning("2026-10-12").slot === "morning", "slots: nextMorning is the next calendar day's morning");
  ok(chicagoTime(Date.UTC(2026, 9, 12, 12, 2)) === "7:02 AM" && chicagoShortDate(MON_10) === "Oct 12", "clock: Chicago time and date labels");

  /* ---- text + keys + types ---- */
  ok(tokens("Send the revised drawings to Bob!").join(" ") === "send revised drawings bob", "text: tokens lowercase, drop punctuation and stopwords");
  ok(
    normalizedTitle("Send Bob the drawings.") === normalizedTitle("drawings — send to bob") && normalizedTitle("the a to") === "",
    "text: normalizedTitle ignores order, punctuation and stopwords; all-stopword → empty"
  );
  ok(
    triageKey.call("TESTX:rec1", "k9") === "call:TESTX:rec1:k9" &&
      JSON.stringify(parseTriageKey("call:TESTX:rec1:k9")) === JSON.stringify({ source: "call", id: "TESTX:rec1", part: "k9" }),
    "keys: a call key splits on its LAST colon (recording ids may hold colons)"
  );
  ok(
    parseTriageKey("asg:as-1")?.source === "assignment" && parseTriageKey("renewal:flame:FT-1")?.part === "flame" && parseTriageKey("renewal:flame:FT-1")?.id === "FT-1",
    "keys: assignment and renewal keys parse"
  );
  ok(
    parseTriageKey("nope:1") === null && parseTriageKey("task:") === null && parseTriageKey("x".repeat(400)) === null && parseTriageKey("renewal:boat:1") === null,
    "keys: unknown prefix, empty id, oversize or bad renewal kind → null"
  );
  ok(
    feedErrorMessage("email") === "Email couldn't be read — list may be incomplete" && feedErrorMessage("assignment") === "Tasks couldn't be read — list may be incomplete",
    "types: the per-feed failure note"
  );
}

export function cand(key: string, source: TriageCandidate["source"], facts: TriageFact[], since = 1, extra: Partial<TriageCandidate> = {}): TriageCandidate {
  return { key, source, title: key, sub: "", href: "/", since, facts, ...extra };
}

export async function triageRankChecks(ok: Ok): Promise<void> {
  const table: Array<[TriageFact, number]> = [
    [{ kind: "lead_sla_breached" }, 60],
    [{ kind: "visit_today", startAt: MON_10 }, 50],
    [{ kind: "task_overdue", days: 1 }, 45],
    [{ kind: "customer_waiting", businessDays: 1 }, 40],
    [{ kind: "quote_awaiting_approval" }, 35],
    [{ kind: "lead_sla_due_soon", minutes: 90 }, 35],
    [{ kind: "task_due_today" }, 30],
    [{ kind: "call_todo" }, 30],
    [{ kind: "portal_quote_review" }, 30],
    [{ kind: "quote_sent_back" }, 30],
    [{ kind: "renewal_past_due", days: 4 }, 30],
    [{ kind: "lead_next_action_overdue" }, 25],
    [{ kind: "task_at_risk" }, 15],
    [{ kind: "linked_open_deal", label: "open quote $1" }, 10],
    [{ kind: "call_names_me" }, 10],
    [{ kind: "visit_flag", label: "Unverified address" }, 10],
    [{ kind: "task_tier", tier: "high" }, 15],
    [{ kind: "task_tier", tier: "low" }, -10],
    [{ kind: "renewal_window", days: 20 }, 15],
    [{ kind: "task_due_tomorrow" }, 15],
    [{ kind: "customer_message_new", hours: 5 }, 10],
    [{ kind: "lead_stale", days: 6 }, 10],
  ];
  for (const [f, p] of table) ok(pointsFor(f) === p, `rank: ${f.kind}${f.kind === "task_tier" ? `/${f.tier}` : ""} = ${p} points`);
  ok(
    pointsFor({ kind: "task_overdue", days: 3 }) === 55 && pointsFor({ kind: "task_overdue", days: 6 }) === 70 && pointsFor({ kind: "task_overdue", days: 40 }) === 70,
    "rank: an overdue task gains +5/day, capped at +30"
  );
  ok(
    pointsFor({ kind: "customer_waiting", businessDays: 2 }) === 50 &&
      pointsFor({ kind: "customer_waiting", businessDays: 4 }) === 70 &&
      pointsFor({ kind: "customer_waiting", businessDays: 12 }) === 70,
    "rank: a waiting customer gains +10 per extra business day, capped at +30"
  );
  ok(scoreOf([{ kind: "task_due_today" }, { kind: "task_tier", tier: "low" }]) === 20, "rank: a row's score is the sum of its facts (Low tier subtracts)");
  ok(
    reasonOf([{ kind: "linked_open_deal", label: "open quote $18,400" }, { kind: "customer_waiting", businessDays: 2 }]) === "Customer waiting 2 business days · open quote $18,400",
    "rank: the reason is the top two facts in words, biggest first"
  );
  ok(reasonOf([{ kind: "task_due_today" }, { kind: "task_tier", tier: "low" }]) === "Due today", "rank: a negative fact never shows as a reason");
  ok(
    factLabel({ kind: "customer_waiting", businessDays: 1 }) === "Customer waiting 1 business day" &&
      factLabel({ kind: "lead_sla_due_soon", minutes: 45 }) === "First response due in 45 min" &&
      factLabel({ kind: "lead_sla_due_soon", minutes: 180 }) === "First response due in 3h" &&
      factLabel({ kind: "visit_today", startAt: MON_10 }) === "Site visit today 10:00 AM",
    "rank: fact labels read plainly"
  );
  const ranked = rankCandidates([
    cand("b", "task", [{ kind: "task_due_today" }], 5),
    cand("a", "task", [{ kind: "task_due_today" }], 5),
    cand("old", "task", [{ kind: "task_due_today" }], 1),
    cand("undated", "task", [{ kind: "task_due_today" }], 0),
    cand("top", "lead", [{ kind: "lead_sla_breached" }], 9),
  ]);
  ok(ranked.map((r) => r.key).join(",") === "top,old,a,b,undated", "rank: score desc → older first → key; an unknown age sorts after known ones");
  ok(ranked[0].score === 60 && ranked[0].reason === "First response overdue", "rank: ranked rows carry their score and reason");
}

export async function triageMatchChecks(ok: Ok): Promise<void> {
  const segs = [
    { speaker: 0, text: "Thanks everyone for coming out today.", start: 0, end: 4 },
    { speaker: 1, text: "I'll send the revised rigging drawings to the architect by Friday.", start: 754, end: 760 },
    { speaker: 0, text: "Drawings look good.", start: 800, end: 802 },
  ];
  const hit = matchTranscriptLine("Send revised rigging drawings to architect", segs);
  ok(!!hit && hit.index === 1 && hit.start === 754 && hit.matched === 5 && hit.share === 1, "transcript: the best segment by word overlap wins");
  ok(matchTranscriptLine("Order new motor controller for the fly system", segs) === null, "transcript: below the 0.5 share → no match");
  ok(matchTranscriptLine("Drawings", segs) === null, "transcript: a one-word to-do never matches (≥ 2-token floor)");
  ok(matchTranscriptLine("Review drawings with the team and the owner", segs) === null, "transcript: 1 matched token of 4 → miss");
  const sw = matchTranscriptLine("the THE to send architect", [{ speaker: 2, text: "send it to the architect", start: 5, end: 6 }]);
  ok(!!sw && sw.matched === 2 && sw.share === 1, "transcript: stopwords and case are ignored");
  ok(matchTranscriptLine("Send architect drawings", []) === null, "transcript: no transcript → no match");
  ok(formatTimestamp(754) === "12:34" && formatTimestamp(3725) === "1:02:05" && formatTimestamp(-3) === "0:00", "transcript: timestamps read m:ss / h:mm:ss");
  ok(clipLine("a".repeat(200)).length === 140 && clipLine("a".repeat(200)).endsWith("…") && clipLine("  x   y ") === "x y", "transcript: lines are clipped and whitespace-collapsed");

  const out = collapseDuplicates(
    [
      cand("task:T1", "task", [], 5, { title: "Send drawings to Bob" }),
      cand("call:R1:k1", "call", [], 10, { title: "send Bob the drawings", mention: "Walkthrough (Oct 7)" }),
      cand("call:R2:k1", "call", [], 20, { title: "Order motor", mention: "Call A (Oct 8)" }),
      cand("call:R3:k2", "call", [], 30, { title: "order the motor!", mention: "Call B (Oct 9)" }),
      cand("call:R4:k3", "call", [], 40, { title: "Book lift", mention: "Call C (Oct 9)" }),
    ],
    [
      { key: "task:T1", title: "Send drawings to Bob" },
      { key: "asg:A9", title: "Book lift" },
    ]
  );
  ok(out.map((c) => c.key).join(",") === "task:T1,call:R2:k1", "dedupe: to-dos matching open work or an earlier to-do collapse away");
  ok((out[0].also ?? []).join("|") === "Also mentioned in Walkthrough (Oct 7)", "dedupe: a to-do matching an open task shows on that task's row");
  ok((out[1].also ?? []).join("|") === "Also mentioned in Call B (Oct 9)", "dedupe: a later duplicate to-do folds into the earliest one");
  ok(!out.some((c) => c.key === "call:R4:k3"), "dedupe: a to-do already tracked as open work off the list is not repeated");
  const blank = collapseDuplicates(
    [cand("call:R5:k", "call", [], 1, { title: "the to", mention: "X" }), cand("call:R6:k", "call", [], 2, { title: "a the", mention: "Y" })],
    []
  );
  ok(blank.length === 2, "dedupe: an all-stopword title never collapses");

  // An off-list open item registered first must not swallow the on-list row's line.
  const offFirst = collapseDuplicates(
    [
      cand("task:T2", "task", [], 5, { title: "Book lift" }),
      cand("call:R7:k", "call", [], 10, { title: "book lift!", mention: "Call D (Oct 9)" }),
    ],
    [
      { key: "asg:A1", title: "Book lift" },
      { key: "task:T2", title: "Book lift" },
    ]
  );
  ok(
    offFirst.length === 1 && offFirst[0].key === "task:T2" && (offFirst[0].also ?? []).join("|") === "Also mentioned in Call D (Oct 9)",
    "dedupe: a duplicate-titled off-list open item registered first still folds its line onto the on-list open work row"
  );

  // A repeat from the same meeting folds away without an "Also mentioned in" line for that same meeting.
  const sameMeeting = collapseDuplicates(
    [
      cand("call:R8:k1", "call", [], 10, { title: "Send the cue list", mention: "Walkthrough (Oct 7)" }),
      cand("call:R8:k2", "call", [], 11, { title: "send the cue list", mention: "Walkthrough (Oct 7)" }),
    ],
    []
  );
  ok(
    sameMeeting.length === 1 && sameMeeting[0].key === "call:R8:k1" && (sameMeeting[0].also ?? []).length === 0,
    "dedupe: a repeat from the same meeting drops with no 'Also mentioned in' line for that meeting"
  );
}

export async function triageFeedChecksA(ok: Ok): Promise<void> {
  /* ---- email ---- */
  const thread = (id: string, since: number, extra: Record<string, unknown> = {}) =>
    ({
      id, mailbox: "personal", mailboxUser: ME.name, unread: true, customerId: null, customer: "Acme Theatre",
      contactName: "Pat", contactEmail: "pat@acme.test", subject: "Rigging quote?", channel: "email",
      status: "waiting_us", assignedTo: ME.name, link: null,
      messages: [{ id: "m1", at: since, direction: "in", channel: "email", author: "Pat", body: "Hi" }],
      createdAt: since, updatedAt: since, ...extra,
    }) as unknown as CommThread;
  const deals: DealIndex = {
    quotes: new Map([["Q-1", { status: "sent", value: 18400 }], ["Q-2", { status: "won", value: 900 }]]),
    leads: new Map([["L-1", { open: true, value: 5000 }]]),
  };
  const em = selectEmail(
    [
      thread("C-1", THU_9, { link: { type: "quote", id: "Q-1" } }),
      thread("C-2", FRI_15),
      thread("C-3", FRI_9, { link: { type: "quote", id: "Q-2" } }),
      thread("C-4", THU_9, { assignedTo: "Someone Else" }),
      thread("C-5", THU_9, { status: "waiting_them" }),
      thread("C-6", THU_9, { archived: true }),
      thread("C-7", THU_9, { gmailInboxed: false }),
      thread("C-8", THU_9, { link: { type: "lead", id: "L-1" } }),
    ],
    deals,
    { me: ME, now: MON_10 }
  );
  ok(em.map((c) => c.key).join(",") === "email:C-1,email:C-2,email:C-3,email:C-8", "email feed: only my waiting, inboxed, unarchived threads");
  ok(
    JSON.stringify(em[0].facts) === JSON.stringify([{ kind: "customer_waiting", businessDays: 2 }, { kind: "linked_open_deal", label: "open quote $18,400" }]),
    "email feed: 2 business days waiting + the linked open quote"
  );
  ok(JSON.stringify(em[1].facts) === JSON.stringify([{ kind: "customer_message_new", hours: 19 }]), "email feed: under one business day ranks lower and shows business hours");
  ok(em[2].facts.length === 1 && em[2].facts[0].kind === "customer_waiting", "email feed: a won quote is not an open deal");
  ok(JSON.stringify(em[3].facts[1]) === JSON.stringify({ kind: "linked_open_deal", label: "open lead $5,000" }), "email feed: a linked open lead counts");
  ok(em[0].href === "/inbox?thread=C-1" && em[0].since === THU_9 && em[0].title === "Acme Theatre" && em[0].sub === "Rigging quote?", "email feed: the row opens the thread; its age is 'waiting since'");

  /* ---- tasks + assignments ---- */
  const FRI_NOON = Date.UTC(2026, 9, 9, 17);
  const MON_18 = Date.UTC(2026, 9, 12, 23);
  const TUE_NOON = Date.UTC(2026, 9, 13, 17);
  const NEXT_WEEK = Date.UTC(2026, 9, 20, 17);
  const tk = (id: string, dueAt: number | null, extra: Partial<TaskRecord> & { priority?: string } = {}) => {
    const { priority, ...rest } = extra;
    const t = normalizeTask({ id, title: `Task ${id}`, assigneeName: ME.name, dueAt, status: "open", createdAt: 1, ...rest });
    return priority ? ({ ...t, priority } as TaskRecord) : t; // spec 3's field — normalizeTask doesn't carry it yet
  };
  const asg = (id: string, dueDate: number, extra: Partial<Assignment> = {}): Assignment => ({
    id, title: `Ask ${id}`, assignee: ME.name, createdBy: "Jeff Chesebro", createdAt: 2, dueDate, link: null,
    done: false, doneAt: null, doneVia: null, source: "", ...extra,
  });
  const tr = selectTasks(
    {
      tasks: [
        tk("T1", FRI_NOON), tk("T2", MON_18, { priority: "high" }), tk("T3", TUE_NOON, { priority: "low" }), tk("T4", NEXT_WEEK),
        tk("T5", null), tk("T6", FRI_NOON, { status: "done" }), tk("T7", FRI_NOON, { assigneeName: "Someone Else" }), tk("T8", NEXT_WEEK, { projectId: "P-1" }),
      ],
      assignments: [asg("A1", MON_18), asg("A2", 0, { done: true }), asg("A3", MON_18, { assignee: "Someone Else" })],
      atRisk: new Set(["task:T5"]),
    },
    { me: ME, now: MON_10 }
  );
  ok(tr.candidates.map((c) => c.key).join(",") === "task:T1,task:T2,task:T3,task:T5,asg:A1", "tasks feed: my open overdue / today / tomorrow / at-risk items only");
  ok(JSON.stringify(tr.candidates[0].facts) === JSON.stringify([{ kind: "task_overdue", days: 3 }]), "tasks feed: days overdue are Chicago calendar days");
  ok(tr.candidates[1].facts.map((f) => f.kind).join(",") === "task_due_today,task_tier", "tasks feed: due today + High tier (when spec 3's priority is present)");
  ok(JSON.stringify(tr.candidates[2].facts) === JSON.stringify([{ kind: "task_due_tomorrow" }, { kind: "task_tier", tier: "low" }]), "tasks feed: due tomorrow + Low tier");
  ok(JSON.stringify(tr.candidates[3].facts) === JSON.stringify([{ kind: "task_at_risk" }]), "tasks feed: the optional at-risk hook adds a fact");
  ok((tr.openWork ?? []).map((w) => w.key).join(",") === "task:T1,task:T2,task:T3,task:T4,task:T5,task:T8,asg:A1", "tasks feed: every open item of mine is open work for the duplicate collapse");
  ok(tr.candidates[4].href === "/queue" && tr.candidates[4].sub === "from Jeff Chesebro" && tr.candidates[0].href === "/calendar", "tasks feed: rows open the queue / calendar like My Queue does");
  ok(tierOf({ priority: "high" }) === "high" && tierOf({ priority: "normal" }) === null && tierOf({}) === null && tierOf(null) === null, "tasks feed: tier is read only when present");
  ok(selectTasks({ tasks: [tk("T9", null)], assignments: [], atRisk: new Set() }, { me: ME, now: MON_10 }).candidates.length === 0, "tasks feed: without the hook an undated task stays off (pre-spec-3 form)");

  /* ---- leads ---- */
  const lead = (id: string, extra: Record<string, unknown> = {}) =>
    ({
      id, org: `Org ${id}`, contact: "", stage: "new", owner: ME.name, value: 0, interest: "", slaHours: 24,
      firstContactAt: null, nextActionAt: null, createdAt: MON_10 - 2 * H, lastActivityAt: MON_10 - 2 * H, ...extra,
    }) as unknown as LeadRecord;
  const lr = selectLeads(
    [
      lead("L1", { createdAt: MON_10 - 30 * H }),
      lead("L2", { createdAt: MON_10 - 21 * H }),
      lead("L3", { stage: "contacted", firstContactAt: 1, nextActionAt: MON_10 - D }),
      lead("L4", { stage: "qualified", firstContactAt: 1, lastActivityAt: MON_10 - 6 * D }),
      lead("L5", { stage: "contacted", firstContactAt: 1 }),
      lead("L6", { createdAt: MON_10 - 30 * H, owner: "Someone Else" }),
      lead("L7", { createdAt: MON_10 - 30 * H, owner: "" }),
      lead("L8", { createdAt: MON_10 - 30 * H, stage: "lost" }),
    ],
    { me: ME, now: MON_10 }
  );
  ok(lr.map((c) => c.key).join(",") === "lead:L1,lead:L2,lead:L3,lead:L4,lead:L7", "leads feed: my open leads (and unassigned ones, like the bell) that need follow-up");
  ok(
    JSON.stringify(lr.map((c) => c.facts)) ===
      JSON.stringify([[{ kind: "lead_sla_breached" }], [{ kind: "lead_sla_due_soon", minutes: 180 }], [{ kind: "lead_next_action_overdue" }], [{ kind: "lead_stale", days: 6 }], [{ kind: "lead_sla_breached" }]]),
    "leads feed: SLA breached, SLA due within 4 h, next action overdue, stale"
  );
  ok(lr[4].sub.includes("unassigned") && lr[0].href === "/leads?lead=L1", "leads feed: unassigned is said; the row opens the lead");
}

export async function triageFeedChecksB(ok: Ok): Promise<void> {
  /* ---- site visits ---- */
  const MON_14 = Date.UTC(2026, 9, 12, 19);
  const TUE_NOON = Date.UTC(2026, 9, 13, 17);
  // Tue 01:00 UTC = Mon 20:00 Chicago: today by Chicago's calendar, tomorrow by UTC's.
  const MON_20_CHI = Date.UTC(2026, 9, 13, 1);
  // Mon 04:00 UTC = Sun 23:00 Chicago: today by UTC's calendar, yesterday by Chicago's.
  const SUN_23_CHI = Date.UTC(2026, 9, 12, 4);
  const visit = (id: string, startAt: number | null, extra: Record<string, unknown> = {}) =>
    ({
      id, customer: `Cust ${id}`, venue: "Main Stage", address: "1 Main St", reason: "Site survey / measure",
      startAt, endAt: startAt ? startAt + H : null, assignedTo: ME.name, stage: "scheduled", ...extra,
    }) as unknown as SiteVisit;
  const vs = [
    visit("V1", MON_14),
    visit("V2", MON_14, { assignedTo: "Someone Else", attendees: ["dana tester"] }),
    visit("V3", MON_14, { assignedTo: "Someone Else" }),
    visit("V4", TUE_NOON),
    visit("V5", MON_14, { stage: "done" }),
    visit("V6", null, { stage: "open" }),
    visit("V7", MON_20_CHI),
    visit("V8", SUN_23_CHI),
  ];
  const mine = todaysVisitsFor(vs, ME.name, MON_10);
  ok(mine.map((v) => v.id).join(",") === "V1,V2,V7", "visits feed: today's (Chicago day), not done, where I'm the lead or an attendee");
  ok(!mine.some((v) => v.id === "V8"), "visits feed: 11 pm Sunday Chicago is yesterday even though it is Monday in UTC");
  ok(visitAttendees(vs[0]).length === 0 && visitAttendees(vs[1]).join() === "dana tester", "visits feed: attendees are read only when present (pre-spec-2 visits have none)");
  const vc = selectVisits(mine, new Map([["V2", ["Unverified address", "Overlaps SV-9"]]]));
  ok(
    JSON.stringify(vc[0].facts) === JSON.stringify([{ kind: "visit_today", startAt: MON_14 }]) &&
      JSON.stringify(vc[1].facts[1]) === JSON.stringify({ kind: "visit_flag", label: "Unverified address · Overlaps SV-9" }) &&
      vc[0].facts.length === 1,
    "visits feed: one +10 flag fact only when a flag provider reports flags"
  );
  ok(vc[0].href === "/calendar?view=day" && vc[0].title === "Cust V1 — Main Stage" && vc[0].sub === "Site survey / measure · 1 Main St", "visits feed: the row opens today's calendar");

  /* ---- quotes ---- */
  const q = (id: string, extra: Record<string, unknown> = {}) =>
    ({ id, name: `Quote ${id}`, customer: "Acme", owner: "Someone Else", status: "draft", value: 1000, sections: [], updatedAt: MON_10 - H, ...extra }) as unknown as Quote;
  const qs = [
    q("Q1", { review: { state: "in_review", submittedAt: MON_10 - 3 * H, submittedBy: "Someone Else" } }),
    q("Q2", { owner: ME.name, review: { state: "changes", decidedBy: "Jeff Chesebro", note: "fix" } }),
    q("Q3", { owner: ME.name, source: "portal-catalog", portalReview: { at: 1 } }),
    q("Q4", { owner: ME.name, review: { state: "in_review", submittedAt: 1 } }),
    q("Q5"),
  ];
  const approver = { ...ME, canApprove: true };
  const qr = selectQuotes(qs, { me: approver, now: MON_10 });
  ok(qr.map((c) => c.key).join(",") === "quote:Q1,quote:Q2,quote:Q3", "quotes feed: awaiting my approval, sent back to me, portal quote to review");
  ok(qr[0].facts[0].kind === "quote_awaiting_approval" && qr[0].since === MON_10 - 3 * H && qr[0].href === "/estimator?id=Q1", "quotes feed: approval rows open the quote's own builder; age = submitted");
  ok(qr[1].facts[0].kind === "quote_sent_back" && qr[2].facts[0].kind === "portal_quote_review" && qr[2].href.startsWith("/quotes/portal"), "quotes feed: sent-back and portal-review rows");
  ok(!selectQuotes(qs, { me: ME, now: MON_10 }).some((c) => c.key === "quote:Q1"), "quotes feed: a non-approver doesn't see another's review unless assigned to them");
  const both = selectQuotes(
    [q("Q6", { owner: ME.name, source: "portal-catalog", portalReview: { at: 1 }, review: { state: "changes", decidedBy: "Jeff Chesebro" } })],
    { me: ME, now: MON_10 }
  );
  ok(both.length === 1 && both[0].facts.map((f) => f.kind).join() === "quote_sent_back,portal_quote_review", "quotes feed: a quote matching two rules is one row carrying both facts");

  /* ---- renewals ---- */
  const rr = selectRenewals(
    [
      { kind: "flame", id: "FT-1", customer: "Acme", venue: "Main", owner: ME.name, contacted: false, renewal: { state: "overdue", days: 4, dueAt: MON_10 - 4 * D } },
      { kind: "inspection", id: "INS-1", customer: "Beta", venue: "Gym", owner: ME.name, contacted: false, renewal: { state: "due_soon", days: 20, dueAt: MON_10 + 20 * D } },
      { kind: "flame", id: "FT-2", customer: "C", venue: "", owner: ME.name, contacted: true, renewal: { state: "overdue", days: 2, dueAt: 1 } },
      { kind: "flame", id: "FT-3", customer: "D", venue: "", owner: "Someone Else", contacted: false, renewal: { state: "overdue", days: 2, dueAt: 1 } },
      { kind: "flame", id: "FT-4", customer: "E", venue: "", owner: ME.name, contacted: false, renewal: { state: "upcoming", days: 90, dueAt: 1 } },
    ],
    { me: ME, now: MON_10 }
  );
  ok(rr.map((c) => c.key).join(",") === "renewal:flame:FT-1,renewal:inspection:INS-1", "renewals feed: my un-contacted renewals in the outreach window or past due");
  ok(
    JSON.stringify(rr.map((c) => c.facts)) === JSON.stringify([[{ kind: "renewal_past_due", days: 4 }], [{ kind: "renewal_window", days: 20 }]]) &&
      rr[0].href === "/flame-tests?rv=contact" && rr[1].href === "/inspections?rv=contact",
    "renewals feed: past due vs in window; rows open the #37 to-contact worklist"
  );
}

export async function triageCallChecks(ok: Ok): Promise<void> {
  const USERS = [{ id: ME.id, name: ME.name }, { id: "u-jeff", name: "Jeff Chesebro" }];
  const item = (key: string, title: string, assigneeName: string | null, disposition = "pending") => ({ key, title, assigneeName, dueDate: null, disposition, assignmentId: null });
  const rec = (id: string, startedAt: number, by: string, items: ReturnType<typeof item>[], segments: { speaker: number; text: string; start: number; end: number }[] = []) =>
    normalizeRecording({
      id, title: `Walkthrough ${id}`, startedAt, createdAt: startedAt, recordedByUserId: by,
      recordedByName: by === ME.id ? ME.name : "Jeff Chesebro", actionItems: items,
      transcript: { language: "en", speakers: { "1": { name: "Pat Owner" } }, segments },
    } as unknown as Partial<RecordingRecord> & { id: string });
  const recs = [
    rec("REC-1", MON_10 - 2 * D, ME.id,
      [item("k1", "Send revised rigging drawings to architect", null), item("k2", "Order motor", "Jeff"), item("k3", "Book lift", null, "accepted"), item("k4", "Call the fire marshal", null, "dismissed")],
      [{ speaker: 1, text: "I'll send the revised rigging drawings to the architect by Friday.", start: 754, end: 760 }]),
    rec("REC-2", MON_10 - 3 * D, "u-jeff", [item("k5", "Confirm trim heights with the venue", "Dana"), item("k6", "Quote spare cable", "Jeff")]),
    rec("REC-3", MON_10 - 8 * D, ME.id, [item("k7", "Old thing to do", null)]),
  ];
  const todos = recordingTodos(recs, { me: ME, now: MON_10, users: USERS });
  ok(todos.map((t) => `${t.meetingId}:${t.itemKey}`).join(",") === "REC-1:k1,REC-2:k5", "calls feed: pending items only, on my recordings or naming me, last 7 days — accepted / dismissed / teammates' items stay off");
  ok(!todos[0].assigneeIsMe && todos[1].assigneeIsMe, "calls feed: knows when a to-do names me");
  const cc = selectCalls(todos);
  const l0 = cc[0].callLine;
  ok(
    cc[0].key === "call:REC-1:k1" && !!l0 && l0.found && l0.speaker === "Pat Owner" && l0.start === 754 && l0.href === "/recordings/REC-1?tab=transcript&seg=0" && cc[0].href === l0.href,
    "calls feed: the matched transcript line links to that moment in the recording"
  );
  const l1 = cc[1].callLine;
  ok(!!l1 && !l1.found && l1.href === "/recordings/REC-2?tab=actions" && cc[1].href === "/recordings/REC-2?tab=actions", "calls feed: no matching line → 'Source line not found — open the meeting'");
  ok(cc[0].facts.map((f) => f.kind).join(",") === "call_todo" && cc[1].facts.map((f) => f.kind).join(",") === "call_todo,call_names_me", "calls feed: +10 when the to-do names me");
  ok(cc[0].mention === `Walkthrough REC-1 (${chicagoShortDate(MON_10 - 2 * D)})`, "calls feed: the meeting + date used by 'Also mentioned in'");
  ok(CALL_WINDOW_MS === 7 * D, "calls feed: the window is 7 days");
  ok(FEEDS.map((f) => f.source).join(",") === "email,call,task,lead,visit,quote,renewal", "feeds: all seven sources are registered, one module each");
}

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
import { feedErrorMessage } from "@/lib/triage/types";

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

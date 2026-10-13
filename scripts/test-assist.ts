/** Assist layer checks (#334). Standalone: `npm run test:assist`; also chained into test:specs. */
import { costUsd, modelFor, wantsFallbacks } from "@/lib/assist/models";
import { assistGate, assistSettingsOf, assistUiFlags, monthKeyChicago, chicagoToday, assistConfigured } from "@/lib/assist/config";

import { readFileSync, readdirSync } from "node:fs";
import { DOC_TABLES, SYNCABLE_COLLECTIONS } from "@/db/doc-tables";
import { CONFIG_COLLECTIONS } from "@/db/seed-data";
import { createRun, getRun, listRunsByMonth, mergeRunDetail, monthSpend, newRunId, setRunOutcome, type AssistRun } from "@/lib/stores/assist-runs";
import { registerFixture } from "./test-fixtures";

export type Ok = (cond: boolean, msg: string) => void;

const ENV_KEY = { ANTHROPIC_API_KEY: "test-key" };

export async function assistPureChecks(ok: Ok): Promise<void> {
  /* models */
  ok(modelFor("tasks", {}) === "claude-haiku-5-5", "assist models: tasks default Haiku 5.5");
  ok(modelFor("reply", {}) === "claude-sonnet-5-5", "assist models: reply default Sonnet 5.5");
  ok(modelFor("estimate", {}) === "claude-opus-5-5", "assist models: estimate default Opus 5.5");
  ok(modelFor("reply", { ASSIST_MODEL_REPLY: " claude-opus-5-5 " }) === "claude-opus-5-5", "assist models: env override trims");
  ok(wantsFallbacks("claude-opus-5-5") && wantsFallbacks("claude-sonnet-5-5") && !wantsFallbacks("claude-haiku-5-5"), "assist models: fallbacks only where supported");
  /* cost */
  const u = { inputTokens: 4000, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 };
  ok(Math.abs(costUsd("claude-haiku-5-5", u) - 0.0006) < 1e-9, "assist cost: haiku 4K/400 = $0.0006");
  ok(Math.abs(costUsd("claude-sonnet-5-5", u) - 0.012) < 1e-9, "assist cost: sonnet 4K/400 = $0.012");
  ok(Math.abs(costUsd("claude-opus-5-5", { ...u, inputTokens: 30000, outputTokens: 3000 }) - 0.18) < 1e-9, "assist cost: opus 30K/3K = $0.18");
  ok(Math.abs(costUsd("claude-haiku-5-5", { inputTokens: 100_001, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }) - 0.0500005) < 1e-6, "assist cost: haiku >100K prompt bills at 5×");
  ok(costUsd("llama-local", u) === 0, "assist cost: unknown/local model is $0");
  /* settings */
  const s0 = assistSettingsOf({});
  ok(s0.users.length === 0 && s0.capUsd === 200 && s0.features.tasks && s0.features.reply && s0.features.estimate, "assist settings: defaults (nobody, $200, all features on)");
  ok(assistSettingsOf({ assistMonthlyCapUsd: 99999 }).capUsd === 10000 && assistSettingsOf({ assistMonthlyCapUsd: -5 }).capUsd === 0, "assist settings: cap clamps 0..10000");
  ok(assistSettingsOf({ assistFeatures: { reply: false } }).features.reply === false, "assist settings: a feature toggled off");
  /* gate */
  const on = assistSettingsOf({ assistUsers: ["u1"] });
  ok(assistGate("tasks", "u1", on, ENV_KEY).ok, "assist gate: listed user + key = ok");
  ok(!assistGate("tasks", "u2", on, ENV_KEY).ok, "assist gate: unlisted user refused");
  ok(!assistGate("tasks", "u1", s0, ENV_KEY).ok, "assist gate: empty list means nobody");
  ok(!assistGate("tasks", "u1", on, {}).ok, "assist gate: no key, no provider = refused");
  ok(!assistGate("tasks", "u1", on, { ...ENV_KEY, ASSIST_DISABLED: "true" }).ok, "assist gate: kill switch");
  ok(!assistGate("reply", "u1", assistSettingsOf({ assistUsers: ["u1"], assistFeatures: { reply: false } }), ENV_KEY).ok, "assist gate: feature toggle");
  ok(assistConfigured({ ASSIST_PROVIDER: "local", ASSIST_LOCAL_URL: "http://mini" }).provider === "local", "assist gate: local provider counts as configured");
  const flags = assistUiFlags("u1", on, ENV_KEY);
  ok(flags.tasks && flags.reply && flags.estimate, "assist gate: ui flags all on for a listed user");
  /* time */
  ok(monthKeyChicago(Date.UTC(2026, 10, 1, 3, 0)) === "2026-10", "assist month: 1 Nov 03:00 UTC is still October in Chicago");
  ok(chicagoToday(Date.UTC(2026, 9, 12, 15, 0)).date === "2026-10-12" && chicagoToday(Date.UTC(2026, 9, 12, 15, 0)).weekday === "Monday", "assist today: Chicago date + weekday");
}

export function fakeRun(over: Partial<AssistRun> = {}): AssistRun {
  return {
    id: newRunId(), feature: "tasks", step: null, userId: "u-assist", userName: "Asa Tester",
    provider: "fake", model: "claude-haiku-5-5", requestedModel: "claude-haiku-5-5", fellBack: false,
    inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.5, latencyMs: 5,
    inputHash: "h", output: "{}", ok: true, error: null, stopReason: "end_turn", contextRef: "thread:C-1",
    monthKey: "2031-01", outcome: null, outcomeDetail: null, outcomeAt: null, createdAt: Date.UTC(2031, 0, 5),
    ...over,
  };
}

export async function assistStoreChecks(ok: Ok): Promise<void> {
  ok("assist_runs" in DOC_TABLES, "assist store: assist_runs is a registered doc table");
  ok(CONFIG_COLLECTIONS.includes("assist_runs" as never), "assist store: kept through the go-live wipe");
  ok(!(SYNCABLE_COLLECTIONS as readonly string[]).includes("assist_runs"), "assist store: not writable through /api/sync/push");
  const mig = readdirSync("drizzle").find((f) => /^\d{4}_assist_runs\.sql$/.test(f));
  const sql = mig ? readFileSync(`drizzle/${mig}`, "utf8") : "";
  ok(/CREATE TABLE IF NOT EXISTS "assist_runs"/.test(sql) && sql.includes("assist_runs_seq_bump"), "assist store: idempotent migration with the seq trigger");

  const mk = async (over: Partial<AssistRun> = {}): Promise<AssistRun> => {
    const r = fakeRun(over);
    registerFixture("assist_runs" as never, r.id);
    return createRun(r);
  };
  const a = await mk({ costUsd: 1.25 });
  await mk({ costUsd: 2.5 });
  await mk({ monthKey: "2031-02", costUsd: 9 });
  ok((await listRunsByMonth("2031-01")).length === 2, "assist store: listRunsByMonth filters by month");
  ok(Math.abs((await monthSpend("2031-01")) - 3.75) < 1e-9, "assist store: monthSpend sums the month");
  ok(!(await setRunOutcome(a.id, "someone-else", "accepted", null)), "assist store: another user can't set the outcome");
  ok(await setRunOutcome(a.id, "u-assist", "edited", { created: 1 }), "assist store: own user sets the outcome");
  ok(!(await setRunOutcome(a.id, "u-assist", "accepted", null)), "assist store: first outcome wins");
  await mergeRunDetail(a.id, { lines: [{ sku: "X", qty: 2 }] });
  const back = await getRun(a.id);
  ok(back?.outcome === "edited" && (back?.outcomeDetail as { created?: number })?.created === 1 && Array.isArray((back?.outcomeDetail as { lines?: unknown })?.lines), "assist store: mergeRunDetail keeps the outcome and adds facts");
  ok((await mk({ output: "x".repeat(30_000) })).output.length === 20_000, "assist store: output capped at 20,000 chars");
}

// Standalone runner (npm run test:assist).
if (process.argv[1] && /test-assist\.ts$/.test(process.argv[1])) {
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
    await assistPureChecks(ok);
    await assistStoreChecks(ok);
    // later tasks append: await assistXChecks(ok);
    console.log(fail ? `\n${fail} FAILED` : "\nall assist checks passed");
    process.exit(fail ? 1 : 0);
  })().catch((err) => {
    console.log("FAIL " + (err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  });
}

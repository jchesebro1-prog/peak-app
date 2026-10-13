/** Assist layer checks (#334). Standalone: `npm run test:assist`; also chained into test:specs. */
import { costUsd, modelFor, wantsFallbacks } from "@/lib/assist/models";
import { buildAnthropicParams, FALLBACK_BETA } from "@/lib/assist/anthropic";
import { buildLocalBody } from "@/lib/assist/local";
import { pickProvider } from "@/lib/assist/provider";
import { assistGate, assistSettingsOf, assistUiFlags, monthKeyChicago, chicagoToday, assistConfigured } from "@/lib/assist/config";
import { z } from "zod";
import { runAssist, toJsonSchema, type RunResult } from "@/lib/assist/run";
import { editRatio, estimateKeep, replyOutcome } from "@/lib/assist/outcome";
import type { AssistProvider, ProviderRequest } from "@/lib/assist/types";
import { sanitizeTaskSuggestions, buildTasksUserText, suggestionEdited, taskSuggestOutcome } from "@/lib/assist/features/task-suggest";
import { threadBlock } from "@/lib/assist/features/thread-text";

import { readFileSync, readdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
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
  // Atomicity: concurrent outcome writes -> exactly one wins, and it is the stored one.
  const c = await mk();
  const [r1, r2] = await Promise.all([
    setRunOutcome(c.id, "u-assist", "accepted", { who: "one" }),
    setRunOutcome(c.id, "u-assist", "edited", { who: "two" }),
  ]);
  ok(r1 !== r2, "assist store: concurrent setRunOutcome applies exactly once");
  const cb = await getRun(c.id);
  ok(cb?.outcome === (r1 ? "accepted" : "edited") && (cb?.outcomeDetail as { who?: string })?.who === (r1 ? "one" : "two"), "assist store: the stored outcome is the winner's");
  // A rejected attempt writes nothing (rev unchanged).
  const revOf = async (id: string): Promise<number> => {
    const db = await getDb();
    const t = DOC_TABLES.assist_runs;
    const rows = await db.select({ rev: t.rev }).from(t).where(eq(t.id, id));
    return Number(rows[0]?.rev);
  };
  const rev0 = await revOf(c.id);
  ok(!(await setRunOutcome(c.id, "u-assist", "discarded", null)) && !(await setRunOutcome(c.id, "someone-else", "discarded", null)), "assist store: rejected attempts return false");
  ok((await revOf(c.id)) === rev0, "assist store: a rejected attempt does not bump rev");
  // mergeRunDetail after an outcome keeps it; a JSON-null outcomeDetail is handled.
  ok(await mergeRunDetail(c.id, { extra: 1 }), "assist store: mergeRunDetail returns true on a live run");
  const cm = await getRun(c.id);
  ok(cm?.outcome === cb?.outcome && (cm?.outcomeDetail as { extra?: number; who?: string })?.extra === 1 && (cm?.outcomeDetail as { who?: string })?.who === (r1 ? "one" : "two"), "assist store: mergeRunDetail does not clobber the outcome");
  const nd = await mk({ outcomeDetail: null });
  ok(await mergeRunDetail(nd.id, { k: 1 }), "assist store: mergeRunDetail on a null outcomeDetail");
  ok(((await getRun(nd.id))?.outcomeDetail as { k?: number })?.k === 1, "assist store: null outcomeDetail merges into an object");
  const nd2 = await mk({ outcomeDetail: null });
  ok(await setRunOutcome(nd2.id, "u-assist", "accepted", { z: 2 }) && ((await getRun(nd2.id))?.outcomeDetail as { z?: number })?.z === 2, "assist store: setRunOutcome over a null outcomeDetail");
  ok(!(await setRunOutcome("AR-missing", "u-assist", "accepted", null)) && !(await mergeRunDetail("AR-missing", { a: 1 })), "assist store: missing run returns false");
  ok((await mk({ output: "x".repeat(30_000) })).output.length === 20_000, "assist store: output capped at 20,000 chars");
}

export async function assistProviderChecks(ok: Ok): Promise<void> {
  const base = { model: "claude-opus-5-5", system: "SYS", user: "USER", effort: "medium" as const, maxTokens: 16000, fallbacks: true };
  const p = buildAnthropicParams({ ...base, jsonSchema: { type: "object" } });
  ok(p.model === "claude-opus-5-5" && p.max_tokens === 16000, "assist anthropic: model + max_tokens");
  ok(!("thinking" in p) && !("tool_choice" in p), "assist anthropic: never sends thinking or tool_choice");
  ok(p.system[0].cache_control?.type === "ephemeral" && p.system[0].text === "SYS", "assist anthropic: cached system block");
  ok(p.output_config.effort === "medium" && (p.output_config as { format?: { type: string } }).format?.type === "json_schema", "assist anthropic: effort + json_schema format in output_config");
  ok((p as { fallbacks?: string }).fallbacks === "default" && (p as { betas?: string[] }).betas?.[0] === FALLBACK_BETA, "assist anthropic: fallbacks default with the 2026-07-01 beta");
  const h = buildAnthropicParams({ ...base, model: "claude-haiku-5-5", fallbacks: false, effort: "low" });
  ok(!("fallbacks" in h) && !("betas" in h) && !("format" in h.output_config), "assist anthropic: haiku text call has no fallbacks/betas/format");
  const l = buildLocalBody({ ...base, jsonSchema: { type: "object" } });
  ok(l.messages[0].role === "system" && (l as { response_format?: { type: string } }).response_format?.type === "json_schema", "assist local: OpenAI-compatible body with json_schema");
  ok(pickProvider({ ANTHROPIC_API_KEY: "k" }).primary.name === "anthropic" && pickProvider({ ANTHROPIC_API_KEY: "k" }).fallback === null, "assist provider: Claude by default, no fallback");
  const loc = pickProvider({ ASSIST_PROVIDER: "local", ASSIST_LOCAL_URL: "http://mini", ANTHROPIC_API_KEY: "k" });
  ok(loc.primary.name === "local" && loc.fallback?.name === "anthropic", "assist provider: local primary with Claude fallback");
  ok(pickProvider({ ASSIST_PROVIDER: "local", ASSIST_LOCAL_URL: "http://mini" }).fallback === null, "assist provider: no key = no fallback");
}

export function fakeProvider(text: string, opts: { fail?: "unreachable" | "declined"; calls?: ProviderRequest[]; name?: "fake" | "local" } = {}): AssistProvider {
  return {
    name: opts.name ?? "fake",
    async complete(req) {
      opts.calls?.push(req);
      if (opts.fail === "unreachable") return { ok: false, error: "local model unavailable", model: req.model, usage: null, stopReason: null, unreachable: true };
      if (opts.fail === "declined") return { ok: false, error: "declined", model: req.model, usage: { inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "refusal" };
      return { ok: true, text, model: req.model, usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "end_turn" };
    },
  };
}
const USER = { id: "u-run", name: "Runa Tester" };
const ENV = { ANTHROPIC_API_KEY: "test" };
// Fixed month far from real data so the cap check is isolated.
const NOW_RUN = Date.UTC(2032, 2, 10, 15, 0);

/** Register the row a runAssist call created so the harness teardown sweeps it. */
function reg<T>(r: RunResult<T>): RunResult<T> {
  if (r.runId) registerFixture("assist_runs" as never, r.runId);
  return r;
}

export async function assistRunChecks(ok: Ok): Promise<void> {
  const Schema = z.strictObject({ n: z.number() });
  const js = toJsonSchema(Schema);
  ok(js.type === "object" && (js as { additionalProperties?: unknown }).additionalProperties === false && !("$schema" in js), "assist run: strictObject → additionalProperties:false, no $schema");

  const settings = assistSettingsOf({ assistUsers: [USER.id], assistMonthlyCapUsd: 1 });
  const calls: ProviderRequest[] = [];
  const r1 = reg(await runAssist({ feature: "tasks", slot: "tasks", user: USER, system: "S", userText: "U", schema: Schema, contextRef: "thread:C-9" }, { provider: fakeProvider('{"n":3}', { calls }), settings, env: ENV, now: NOW_RUN }));
  ok(r1.ok && r1.value.n === 3 && !!r1.runId, "assist run: parses + validates JSON");
  ok(calls[0].model === "claude-haiku-5-5" && calls[0].effort === "low" && !calls[0].fallbacks && !!calls[0].jsonSchema, "assist run: tasks → Haiku, low effort, schema sent");
  const bad = reg(await runAssist({ feature: "tasks", slot: "tasks", user: USER, system: "S", userText: "U", schema: Schema, contextRef: "thread:C-9" }, { provider: fakeProvider('{"n":"x"}'), settings, env: ENV, now: NOW_RUN }));
  ok(!bad.ok && bad.error === "unreadable answer" && !!bad.runId, "assist run: schema failure logged, not returned");
  const refused = reg(await runAssist({ feature: "reply", slot: "reply", user: USER, system: "S", userText: "U", contextRef: "thread:C-9" }, { provider: fakeProvider("", { fail: "declined" }), settings, env: ENV, now: NOW_RUN }));
  ok(!refused.ok && refused.error === "declined", "assist run: refusal = no draft");
  const empty = reg(await runAssist({ feature: "reply", slot: "reply", user: USER, system: "S", userText: "U", contextRef: "thread:C-9" }, { provider: fakeProvider("  \n "), settings, env: ENV, now: NOW_RUN }));
  ok(!empty.ok && empty.error === "empty answer" && !!empty.runId, "assist run: blank text with no schema = empty answer, still logged");
  const gated = reg(await runAssist({ feature: "tasks", slot: "tasks", user: { id: "nobody", name: "N" }, system: "S", userText: "U", contextRef: "x" }, { provider: fakeProvider("{}"), settings, env: ENV, now: NOW_RUN }));
  ok(!gated.ok && gated.runId === null, "assist run: gate refusal makes no call and no row");
  // Cap: $1. Push spend over the cap with a big fake run.
  const big = fakeRun({ userId: USER.id, monthKey: "2032-03", costUsd: 5 });
  registerFixture("assist_runs" as never, big.id);
  await createRun(big);
  const capped = reg(await runAssist({ feature: "tasks", slot: "tasks", user: USER, system: "S", userText: "U", contextRef: "x" }, { provider: fakeProvider("ok"), settings, env: ENV, now: NOW_RUN }));
  ok(!capped.ok && /cap/.test(capped.error) && capped.runId === null, "assist run: at the cap → paused, no row");
  // Local fallback → Haiku.
  const fbCalls: ProviderRequest[] = [];
  const settings2 = assistSettingsOf({ assistUsers: [USER.id] });
  const fb = reg(await runAssist({ feature: "reply", slot: "reply", user: USER, system: "S", userText: "U", contextRef: "x" }, {
    provider: fakeProvider("", { fail: "unreachable", name: "local" }), fallback: fakeProvider("hello", { calls: fbCalls }), settings: settings2, env: ENV, now: Date.UTC(2033, 0, 5),
  }));
  ok(fb.ok && fb.value === "hello" && fbCalls[0]?.model === "claude-haiku-5-5" && fbCalls[0]?.fallbacks === false, "assist run: unreachable local falls back to Haiku");
  const fbRow = fb.runId ? await getRun(fb.runId) : null;
  ok(fbRow?.fellBack === true && fbRow?.requestedModel === "claude-sonnet-5-5" && fbRow?.monthKey === "2033-01", "assist run: the logged row records the fallback and the requested model");
}

export async function assistOutcomeChecks(ok: Ok): Promise<void> {
  ok(editRatio("a b c", "a b c") === 0 && editRatio("", "") === 0, "assist outcome: identical = 0");
  ok(Math.abs(editRatio("a b c d", "a b x d") - 0.25) < 1e-9, "assist outcome: one word swapped of four = 0.25");
  ok(replyOutcome("thanks for the note we will send the revised drawings over on friday", "thanks for the note we will send the revised drawings over on friday morning").outcome === "accepted", "assist outcome: light edit = accepted");
  ok(replyOutcome("thanks for the note", "completely different reply text here").outcome === "edited", "assist outcome: rewrite = edited");
  const q = { spec: { sections: [{ kind: "materials", items: [{ sku: "A", qty: 2 }, { sku: "B", qty: 5 }, { sku: "Z", qty: 1, bonus: { kind: "package" } }] }] } };
  const k = estimateKeep([{ sku: "A", qty: 2 }, { sku: "B", qty: 3 }, { sku: "C", qty: 1 }, { sku: "", qty: 1 }], q);
  ok(k.kept === 1 && k.changed === 1 && k.removed === 1 && k.total === 3 && k.outcome === "edited", "assist outcome: estimate kept/changed/removed, custom lines ignored");
  ok(estimateKeep([{ sku: "A", qty: 2 }], null).outcome === "discarded", "assist outcome: deleted quote = discarded");
  ok(estimateKeep([{ sku: "A", qty: 2 }, { sku: "B", qty: 5 }], q).outcome === "accepted", "assist outcome: all kept = accepted");
}

export async function assistTaskChecks(ok: Ok): Promise<void> {
  const tb = threadBlock({ subject: 'Re: <Quote> "X"', messages: [
    { direction: "out", author: "Jeff", at: Date.UTC(2026, 9, 2), body: "second" },
    { direction: "in", author: "Pat", at: Date.UTC(2026, 9, 1), body: "first " + "y".repeat(50) },
  ] }, { maxMessages: 8, maxChars: 20 });
  ok(tb.startsWith('<email_thread subject="Re: Quote X">') && tb.indexOf("first") < tb.indexOf("second") && tb.includes("[trimmed]"), "assist thread: wrapped, oldest-first, trimmed, subject defanged");
  const ctx = { today: "2026-10-12", teamIds: new Set(["u1", "u2"]), linkKeys: new Set(["thread", "customer"]) };
  const out = sanitizeTaskSuggestions({ tasks: [
    { title: "  Send quote ", notes: "n", dueDate: "2026-10-15", assigneeUserId: "u2", linkKeys: ["customer", "bogus"], tier: "high", size: "s" },
    { title: "send QUOTE", notes: "", dueDate: "", assigneeUserId: "", linkKeys: [], tier: "low", size: "l" },
    { title: "Call back", notes: "", dueDate: "2026-10-01", assigneeUserId: "ghost", linkKeys: [], tier: "normal", size: "m" },
    { title: "", notes: "", dueDate: "", assigneeUserId: "", linkKeys: [], tier: "normal", size: "m" },
  ] }, ctx);
  ok(out.length === 2, "assist tasks: blank + case-insensitive duplicate titles dropped");
  ok(out[0].title === "Send quote" && out[0].dueDate === "2026-10-15" && out[0].assigneeUserId === "u2", "assist tasks: valid fields kept");
  ok(out[0].linkKeys.join(",") === "thread,customer", "assist tasks: thread link always on, unknown links dropped");
  ok(out[1].dueDate === "" && out[1].assigneeUserId === "", "assist tasks: past date + unknown assignee cleared");
  const many = sanitizeTaskSuggestions({ tasks: Array.from({ length: 9 }, (_, i) => ({ title: "T" + i, notes: "", dueDate: "", assigneeUserId: "", linkKeys: [], tier: "normal" as const, size: "m" as const })) }, ctx);
  ok(many.length === 5, "assist tasks: at most 5");
  const ut = buildTasksUserText({ thread: "<email_thread/>", today: "2026-10-12", weekday: "Monday", team: [{ id: "u1", name: "A" }], links: [{ key: "thread", label: "This email" }] });
  ok(ut.includes("Monday 2026-10-12") && ut.includes("u1 — A") && ut.includes("thread — This email"), "assist tasks: user text lists date, team, links");
  ok(taskSuggestOutcome({ suggested: 3, created: 0, edited: 0 }) === "discarded" && taskSuggestOutcome({ suggested: 3, created: 3, edited: 0 }) === "accepted" && taskSuggestOutcome({ suggested: 3, created: 2, edited: 0 }) === "edited" && taskSuggestOutcome({ suggested: 3, created: 3, edited: 1 }) === "edited", "assist tasks: outcome discarded / accepted / edited");
  ok(!suggestionEdited(out[0], { ...out[0], linkKeys: [...out[0].linkKeys].reverse() }) && suggestionEdited(out[0], { ...out[0], size: "l" }) && suggestionEdited(out[0], { ...out[0], title: "Send quote now" }), "assist tasks: edit detection ignores link order, sees field changes");
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
    await assistProviderChecks(ok);
    await assistRunChecks(ok);
    await assistOutcomeChecks(ok);
    await assistTaskChecks(ok);
    // later tasks append: await assistXChecks(ok);
    console.log(fail ? `\n${fail} FAILED` : "\nall assist checks passed");
    process.exit(fail ? 1 : 0);
  })().catch((err) => {
    console.log("FAIL " + (err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  });
}

/** Assist layer checks (#334). Standalone: `npm run test:assist`; also chained into test:specs. */
import { costUsd, modelFor, wantsFallbacks } from "@/lib/assist/models";
import { assistGate, assistSettingsOf, assistUiFlags, monthKeyChicago, chicagoToday, assistConfigured } from "@/lib/assist/config";

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

// Standalone runner (npm run test:assist).
if (process.argv[1] && /test-assist\.ts$/.test(process.argv[1])) {
  let fail = 0;
  const ok: Ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  (async () => {
    await assistPureChecks(ok);
    // later tasks append: await assistXChecks(ok);
    console.log(fail ? `\n${fail} FAILED` : "\nall assist checks passed");
    process.exit(fail ? 1 : 0);
  })();
}

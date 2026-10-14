/** runAssist (D872): gate → cap → rate limit → provider → validate → log. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { getSettings } from "@/lib/settings";
import { rateLimit } from "@/lib/rate-limit";
import { createRun, monthSpend, newRunId, type AssistRun } from "@/lib/stores/assist-runs";
import { assistGate, assistSettingsOf, monthKeyChicago } from "./config";
import { claudeCostUsd, FALLBACK_HAIKU, modelFor, SLOT_SETTINGS, wantsFallbacks, type ModelSlot } from "./models";
import { pickProvider } from "./provider";
import { getAssistEnv } from "./key-store";
import { ZERO_USAGE, type AssistFeature, type AssistProvider, type AssistSettings, type AssistStep, type Env, type ProviderRequest } from "./types";

/** Per user per hour. `file` / `promise` run in background sync passes (#335);
 *  `brief` covers the brief summary and quiet-quote nudges (Rebuild has its own 3/h). */
export const RATE_LIMITS: Record<AssistFeature, number> = { tasks: 60, reply: 60, estimate: 20, file: 600, promise: 600, brief: 60, ask: 60 };

/** zod → JSON Schema for output_config.format; `$schema` dropped. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

export type RunArgs<T> = {
  feature: AssistFeature;
  step?: AssistStep | null;
  slot: ModelSlot;
  user: { id: string; name: string };
  system: string;
  userText: string;
  schema?: z.ZodType<T>;
  contextRef: string;
  /** false = don't count this call against the per-hour limit (the estimate's 2nd call; background pre-drafting). */
  countRate?: boolean;
  /** Background callers (the brief's draft queue): cap this call below the slot's own timeout / retries. */
  limits?: CallLimits;
};
/** Caps only ever shorten a slot's SLOT_SETTINGS values, never lengthen them. */
export type CallLimits = { timeoutMs?: number; maxRetries?: number };
export type RunDeps = { provider?: AssistProvider; fallback?: AssistProvider | null; now?: number; settings?: AssistSettings; env?: Env };
/** A background caller's hard stop: the call is capped to the time left after
 *  the function's own loads (call-budget.ts `limitsBefore`), and refused
 *  (kind "deadline") when less than `minCallMs` would be left. */
export type CallDeadline = { at: number; hasFallback: boolean; minCallMs: number; clock?: () => number };
/** A reusable server function's options: runAssist's deps plus the call's own rate/limit choices. */
export type AssistCallDeps = RunDeps & { countRate?: boolean; limits?: CallLimits; deadline?: CallDeadline };
export type RunResult<T> = { ok: true; runId: string; value: T } | { ok: false; runId: string | null; error: string };

/** A cap only ever shortens: min(slot, cap), clamped to `floor` — a 0 / negative
 *  timeout must never read as "unset" (the provider's longer default). */
export function capAt(slotValue: number, cap: number | undefined, floor: number): number {
  if (typeof cap !== "number" || !Number.isFinite(cap)) return slotValue;
  return Math.min(slotValue, Math.max(floor, Math.floor(cap)));
}

export async function runAssist<T = string>(args: RunArgs<T>, deps: RunDeps = {}): Promise<RunResult<T>> {
  // D881: the effective key (Settings ?? env var) unless the caller passed its own env.
  const env = deps.env ?? (await getAssistEnv());
  const now = deps.now ?? Date.now();
  const settings = deps.settings ?? assistSettingsOf(await getSettings());
  const gate = assistGate(args.feature, args.user.id, settings, env);
  if (!gate.ok) return { ok: false, runId: null, error: gate.reason };
  const monthKey = monthKeyChicago(now);
  if ((await monthSpend(monthKey)) >= settings.capUsd) {
    return { ok: false, runId: null, error: "Assist paused for the month (spend cap reached)." };
  }
  if (args.countRate !== false && !rateLimit(`assist:${args.feature}:${args.user.id}`, RATE_LIMITS[args.feature], 3_600_000).ok) {
    return { ok: false, runId: null, error: "Too many Assist requests — try again in a bit." };
  }

  const picked = deps.provider ? { primary: deps.provider, fallback: deps.fallback ?? null } : pickProvider(env);
  const requestedModel = modelFor(args.slot, env);
  const s = SLOT_SETTINGS[args.slot];
  const req: ProviderRequest = {
    model: picked.primary.name === "local" ? (env.ASSIST_LOCAL_MODEL || "").trim() || requestedModel : requestedModel,
    system: args.system,
    user: args.userText,
    jsonSchema: args.schema ? toJsonSchema(args.schema) : undefined,
    effort: s.effort,
    maxTokens: s.maxTokens,
    fallbacks: picked.primary.name !== "local" && wantsFallbacks(requestedModel),
    timeoutMs: capAt(s.timeoutMs, args.limits?.timeoutMs, 1),
    maxRetries: capAt(s.maxRetries, args.limits?.maxRetries, 0),
    stream: s.stream,
  };

  const t0 = Date.now();
  let provider = picked.primary;
  let res = await provider.complete(req);
  let fellBack = false;
  let sentModel = req.model;
  if (!res.ok && res.unreachable && picked.fallback) {
    provider = picked.fallback;
    fellBack = true;
    sentModel = FALLBACK_HAIKU;
    res = await provider.complete({ ...req, model: FALLBACK_HAIKU, fallbacks: false });
  }
  const latencyMs = Date.now() - t0;

  let ok = res.ok;
  let error: string | null = res.ok ? null : res.error;
  let value: unknown = undefined;
  if (res.ok) {
    if (args.schema) {
      try {
        const parsed = args.schema.safeParse(JSON.parse(res.text));
        if (parsed.success) value = parsed.data;
        else { ok = false; error = "unreadable answer"; }
      } catch {
        ok = false;
        error = "unreadable answer";
      }
    } else if (!res.text.trim()) {
      ok = false;
      error = "empty answer";
    } else {
      value = res.text;
    }
  }
  const usage = res.usage ?? ZERO_USAGE;
  const run: AssistRun = {
    id: newRunId(now),
    feature: args.feature,
    step: args.step ?? null,
    userId: args.user.id,
    userName: args.user.name,
    provider: provider.name,
    model: res.model,
    requestedModel,
    fellBack,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    // Claude (and the test fake) bill by billedPrice: answered → requested → dearest row. Local is $0.
    costUsd: provider.name === "local" ? 0 : claudeCostUsd(res.model, sentModel, usage),
    latencyMs,
    inputHash: createHash("sha256").update(args.system + "\n" + args.userText).digest("hex"),
    output: res.ok ? res.text : "",
    ok,
    error,
    stopReason: res.stopReason,
    contextRef: args.contextRef,
    monthKey,
    outcome: null,
    outcomeDetail: null,
    outcomeAt: null,
    createdAt: now,
  };
  await createRun(run);
  return ok ? { ok: true, runId: run.id, value: value as T } : { ok: false, runId: run.id, error: error || "Assist failed." };
}

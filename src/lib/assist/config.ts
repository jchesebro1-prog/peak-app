/** Assist gate + settings (D869). Pure — callers pass settings and env. */
import type { AssistFeature, AssistSettings, Env } from "./types";
import { modelFor } from "./models";

export const ASSIST_FEATURES: AssistFeature[] = ["tasks", "reply", "estimate"];
export const DEFAULT_CAP_USD = 200;

type StoredAssist = {
  assistUsers?: unknown;
  assistFeatures?: unknown;
  assistMonthlyCapUsd?: unknown;
};

export function assistSettingsOf(s: StoredAssist | null | undefined): AssistSettings {
  const users = Array.isArray(s?.assistUsers) ? (s!.assistUsers as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const f = (s?.assistFeatures && typeof s.assistFeatures === "object" ? s.assistFeatures : {}) as Record<string, unknown>;
  const features = Object.fromEntries(ASSIST_FEATURES.map((k) => [k, f[k] !== false])) as Record<AssistFeature, boolean>;
  const capRaw = Number(s?.assistMonthlyCapUsd);
  const capUsd = Number.isFinite(capRaw) && s?.assistMonthlyCapUsd !== undefined && s?.assistMonthlyCapUsd !== null
    ? Math.min(10_000, Math.max(0, capRaw))
    : DEFAULT_CAP_USD;
  return { users, features, capUsd };
}

export function assistConfigured(env: Env = process.env): { ok: boolean; provider: "anthropic" | "local" | null } {
  if ((env.ASSIST_DISABLED || "").trim() === "true") return { ok: false, provider: null };
  if ((env.ASSIST_PROVIDER || "").trim() === "local" && (env.ASSIST_LOCAL_URL || "").trim()) return { ok: true, provider: "local" };
  if ((env.ANTHROPIC_API_KEY || "").trim()) return { ok: true, provider: "anthropic" };
  return { ok: false, provider: null };
}

export function assistGate(
  feature: AssistFeature,
  userId: string,
  settings: AssistSettings,
  env: Env = process.env
): { ok: true } | { ok: false; reason: string } {
  if ((env.ASSIST_DISABLED || "").trim() === "true") return { ok: false, reason: "Assist is switched off." };
  if (!assistConfigured(env).ok) return { ok: false, reason: "Assist is not set up." };
  if (!userId || !settings.users.includes(userId)) return { ok: false, reason: "Assist isn't enabled for you." };
  if (!settings.features[feature]) return { ok: false, reason: "This Assist feature is turned off." };
  return { ok: true };
}

export function assistUiFlags(userId: string, settings: AssistSettings, env: Env = process.env): Record<AssistFeature, boolean> {
  return Object.fromEntries(ASSIST_FEATURES.map((f) => [f, assistGate(f, userId, settings, env).ok])) as Record<AssistFeature, boolean>;
}

const MONTH_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" });
const DAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
const WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "long" });

/** "2026-10" in America/Chicago. */
export function monthKeyChicago(ms: number): string {
  return MONTH_FMT.format(new Date(ms)).slice(0, 7);
}

/** { date: "2026-10-12", weekday: "Monday" } in America/Chicago. */
export function chicagoToday(ms: number): { date: string; weekday: string } {
  return { date: DAY_FMT.format(new Date(ms)), weekday: WEEKDAY_FMT.format(new Date(ms)) };
}

export function assistStatusLine(env: Env = process.env): string {
  if ((env.ASSIST_DISABLED || "").trim() === "true") return "Kill switch on (ASSIST_DISABLED=true) — Assist is off.";
  const c = assistConfigured(env);
  if (!c.ok) return "Not configured — set ANTHROPIC_API_KEY.";
  const models = `tasks ${modelFor("tasks", env)} · reply ${modelFor("reply", env)} · estimate ${modelFor("extract", env)} → ${modelFor("estimate", env)}`;
  if (c.provider === "local") {
    return `Mac mini (local${env.ASSIST_LOCAL_MODEL ? ": " + env.ASSIST_LOCAL_MODEL : ""})${(env.ANTHROPIC_API_KEY || "").trim() ? ", Claude Haiku fallback" : ", no fallback"}.`;
  }
  return `Claude API — ${models}.`;
}

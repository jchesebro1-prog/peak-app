/** Assist gate + settings (D869). Pure — callers pass settings and env. */
import type { AssistFeature, AssistSettings, Env } from "./types";
import { modelFor } from "./models";

export const ASSIST_FEATURES: AssistFeature[] = ["tasks", "reply", "estimate", "file", "promise", "brief", "ask", "vendorpdf"];
export const DEFAULT_CAP_USD = 200;
/** Features that stay off until an admin turns them on (D897; `brief` — AI daily brief; `ask` — Ask AI; `vendorpdf` — Read the PDF). */
export const OPT_IN_FEATURES: ReadonlySet<AssistFeature> = new Set<AssistFeature>(["file", "promise", "brief", "ask", "vendorpdf"]);

type StoredAssist = {
  assistUsers?: unknown;
  assistFeatures?: unknown;
  assistMonthlyCapUsd?: unknown;
};

export function assistSettingsOf(s: StoredAssist | null | undefined): AssistSettings {
  const users = Array.isArray(s?.assistUsers) ? (s!.assistUsers as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const f = (s?.assistFeatures && typeof s.assistFeatures === "object" ? s.assistFeatures : {}) as Record<string, unknown>;
  // tasks / reply / estimate are on unless switched off; the #335 Inbox
  // organization switches (file, promise), the daily brief and Ask AI are off
  // until turned on (D897)
  const features = Object.fromEntries(
    ASSIST_FEATURES.map((k) => [k, OPT_IN_FEATURES.has(k) ? f[k] === true : f[k] !== false])
  ) as Record<AssistFeature, boolean>;
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
  return assistAccess(feature, userId, settings);
}

/** The pilot-list + feature-switch half of assistGate — needs no env, so a caller can refuse a non-pilot user
 *  before reading the stored key (#348 slice 5: the Estimator page runs Read the PDF's gate on every load). */
export function assistAccess(feature: AssistFeature, userId: string, settings: AssistSettings): { ok: true } | { ok: false; reason: string } {
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

/** Where the Claude key comes from (D881). */
export type KeySource = "settings" | "env" | "none";

/** What the Settings card may know about the key — never the key itself (D881). */
export type AssistKeyInfo = {
  /** The effective source after the preview rule. */
  source: KeySource;
  /** Last four characters of the stored key; null when none is stored. */
  last4: string | null;
  savedAt: number | null;
  savedBy: string | null;
  /** A key is stored but can't be decrypted (AUTH_SECRET changed?). */
  unreadable: boolean;
  /** A key is stored, but this is a Vercel preview deploy that ignores it. */
  previewIgnored: boolean;
};

const API_KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;

/** Trim; must look like an Anthropic key. Returns the cleaned key or null. */
export function cleanApiKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const k = raw.trim();
  return API_KEY_RE.test(k) ? k : null;
}

/** A Vercel preview deploy that must not use the stored key (D881 — previews share the production DB). */
export function storedKeyBlocked(env: Env): boolean {
  return (env.VERCEL_ENV || "").trim() === "preview" && (env.ASSIST_ALLOW_PREVIEW_KEY || "").trim() !== "true";
}

/** Pure precedence rule (D881): a readable, allowed stored key wins; else the env var; else none. */
export function effectiveAnthropicKey(input: { stored: string | null; storedUnreadable: boolean; env: Env }): { key: string | null; source: KeySource } {
  const stored = input.storedUnreadable ? null : cleanApiKey(input.stored);
  if (stored && !storedKeyBlocked(input.env)) return { key: stored, source: "settings" };
  const envKey = (input.env.ANTHROPIC_API_KEY || "").trim();
  if (envKey) return { key: envKey, source: "env" };
  return { key: null, source: "none" };
}

function keySourceNote(k: AssistKeyInfo): string {
  if (k.source === "settings") return `from Settings (…${k.last4 ?? "????"})`;
  if (k.source === "env") return "from the Vercel env var";
  return "no key";
}

export function assistStatusLine(env: Env = process.env, keyInfo?: AssistKeyInfo): string {
  if ((env.ASSIST_DISABLED || "").trim() === "true") return "Kill switch on (ASSIST_DISABLED=true) — Assist is off.";
  const c = assistConfigured(env);
  if (!c.ok) return keyInfo ? "Not configured — paste a Claude API key below, or set ANTHROPIC_API_KEY." : "Not configured — set ANTHROPIC_API_KEY.";
  const models = `tasks ${modelFor("tasks", env)} · reply ${modelFor("reply", env)} · estimate ${modelFor("extract", env)} → ${modelFor("estimate", env)} · file ${modelFor("file", env)} · promise ${modelFor("promise", env)} · brief ${modelFor("brief", env)} · ask ${modelFor("ask", env)} / ${modelFor("askHard", env)} · vendorpdf ${modelFor("vendorpdf", env)} / ${modelFor("vendorpdfHard", env)}`;
  if (c.provider === "local") {
    const hasKey = !!(env.ANTHROPIC_API_KEY || "").trim();
    const fb = hasKey ? `, Claude Haiku fallback${keyInfo ? ` (key ${keySourceNote(keyInfo)})` : ""}` : ", no fallback";
    return `Mac mini (local${env.ASSIST_LOCAL_MODEL ? ": " + env.ASSIST_LOCAL_MODEL : ""})${fb}.`;
  }
  return `Claude API${keyInfo ? ` (key ${keySourceNote(keyInfo)})` : ""} — ${models}.`;
}

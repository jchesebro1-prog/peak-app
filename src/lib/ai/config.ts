/**
 * AI features — configuration & env gate (Phase 8).
 *
 * The entire AI layer is INERT until Jeff supplies an Anthropic API key. It
 * turns on only when ANTHROPIC_API_KEY is set — the same "inert until the
 * credential lands" posture as the Gmail bridge (Phase 7). No opt-in flag on
 * top of the key: unlike Gmail (where Google SSO can be configured for sign-in
 * without wanting mailbox access), the API key exists for one purpose, so its
 * presence IS the opt-in. Set AI_DISABLED=true to force it off while a key is
 * present (kill switch for an incident).
 *
 * When the gate is off, every feature's server action returns a friendly
 * "not enabled" result and every UI affordance renders inert — nothing calls
 * Anthropic, and the surrounding flows (renewal mailto, Inbox, Import, the
 * Estimator) behave exactly as they did before Phase 8.
 *
 * No new npm dependency: every Anthropic call is a plain fetch() against the
 * documented Messages API (POST /v1/messages), mirroring how the Gmail bridge
 * uses fetch() against Gmail's REST API. Keeps the dependency surface (and this
 * locked-down machine's node_modules) unchanged.
 *
 * GUARDRAIL (MASTER-QUESTIONS D6): the AI only ever DRAFTS. A human always
 * reviews and sends — nothing here auto-sends email, commits a quote, or writes
 * a customer record without an explicit human action afterwards.
 */

/** Anthropic Messages API endpoint + version (plain REST, no SDK). */
export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Default model. Opus 4.8 is Anthropic's most capable model and the right
 * default for drafting/extraction/analysis quality; override with
 * ANTHROPIC_MODEL if a deployment wants a cheaper tier (e.g. claude-haiku-4-5).
 * (Model id verified against the claude-api skill, 2026-07-11.)
 */
export const DEFAULT_MODEL = "claude-opus-4-8";

export function aiModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

export function apiKey(): string {
  return process.env.ANTHROPIC_API_KEY || "";
}

/** The master env gate — true only when a key is present and not killed. */
export function aiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY && process.env.AI_DISABLED !== "true";
}

/** Per-request wall-clock budget (ms). Generous — Opus can take a while on
 *  the assistant/analysis prompts — but bounded so a hung request can't wedge
 *  a server action. Overridable for slow links. */
export function aiTimeoutMs(): number {
  const n = Number(process.env.AI_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

/** The five AI features, each independently described for the Settings card
 *  (MASTER-QUESTIONS D1–D5). They all share the single gate above — there's no
 *  per-feature toggle yet; the whole layer is on or off with the key. */
export type AiFeature = {
  key: string;
  label: string;
  desc: string;
  where: string;
};

export const AI_FEATURES: AiFeature[] = [
  // "renewal" retired (D75, 2026-07-19): renewal drafts are rules-based
  // standard language now — templates editable in /templates, no model call.
  {
    key: "summary",
    label: "Thread & customer summaries",
    desc: "Summarize a long email thread or a customer's whole history in the Inbox sidebar.",
    where: "Inbox → thread reader",
  },
  {
    key: "extract",
    label: "Import extraction",
    desc: "Turn messy pasted text (a price list, an emailed spec, a copied table) into clean import rows.",
    where: "Import → paste step",
  },
  {
    key: "scope",
    label: "Quote scope & line drafting",
    desc: "Draft quote scope text and suggested line items from a field survey or inspection's findings.",
    where: "Estimator → new quote",
  },
  {
    key: "assistant",
    label: "Ask about your business data",
    desc: "Ask plain-English questions about quotes, customers, renewals and the pipeline; answers cite the live numbers.",
    where: "Assistant",
  },
];

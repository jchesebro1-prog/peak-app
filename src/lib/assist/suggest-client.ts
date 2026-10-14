/**
 * Estimate suggestion — the client half of every entry point (spec
 * 2026-10-13 §3): POST the source to the route, read the reply defensively,
 * then open the Estimator. Client-safe: no stores, no server imports — only
 * types. The route can take 1–3 minutes (two model calls), so callers show
 * SUGGEST_BUSY_LABEL and guard double clicks (`useSuggestEstimate`).
 */
import type { SuggestSourceKind } from "./features/suggest-sources";

export type SuggestStartSource = { kind: SuggestSourceKind; id: string };
export type SuggestStartResult = { ok: true; suggestionId: string; href: string } | { ok: false; error: string };

export const SUGGEST_ROUTE = "/api/assist/suggest-estimate";
export const SUGGEST_START_ERROR = "Couldn't start the suggestion — try again.";
export const SUGGEST_BUSY_LABEL = "Suggesting… (can take a minute or two)";
const ERROR_MAX = 300;

/** Only an Estimator link may be followed — never an absolute or protocol-relative URL from a reply. */
export function isSuggestionLink(href: unknown): href is string {
  return typeof href === "string" && href.startsWith("/estimator?") && href.length <= 2000;
}

/** The parts of a fetch Response the reader needs (a fake in tests). */
export type SuggestResponseLike = {
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
};

/**
 * Pure: a route reply → a result. Anything but an HTTP-ok JSON reply of the
 * right shape (a signed-out redirect to the HTML login page, a 5xx, a proxy
 * error page, a timeout body) is the generic SUGGEST_START_ERROR — never a
 * parse crash.
 */
export async function readSuggestResponse(res: SuggestResponseLike): Promise<SuggestStartResult> {
  const fail: SuggestStartResult = { ok: false, error: SUGGEST_START_ERROR };
  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!res.ok || type !== "application/json") return fail;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return fail;
  }
  if (!body || typeof body !== "object") return fail;
  const b = body as Record<string, unknown>;
  if (b.ok === true && typeof b.suggestionId === "string" && b.suggestionId && isSuggestionLink(b.href)) {
    return { ok: true, suggestionId: b.suggestionId, href: b.href };
  }
  if (b.ok === false && typeof b.error === "string" && b.error.trim()) return { ok: false, error: b.error.trim().slice(0, ERROR_MAX) };
  return fail;
}

export type SuggestFetch = (url: string, init: RequestInit) => Promise<SuggestResponseLike>;

/**
 * POST the source, then `router.push(href)` on success. Never throws: a
 * network failure or an unreadable reply comes back as `{ ok: false }` for
 * the caller to show inline.
 */
export async function startSuggestion(
  source: SuggestStartSource,
  router: { push(href: string): void },
  fetchImpl: SuggestFetch = (url, init) => fetch(url, init)
): Promise<SuggestStartResult> {
  let res: SuggestResponseLike;
  try {
    res = await fetchImpl(SUGGEST_ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: source.kind, id: source.id }),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: SUGGEST_START_ERROR };
  }
  const r = await readSuggestResponse(res);
  if (r.ok) router.push(r.href);
  return r;
}

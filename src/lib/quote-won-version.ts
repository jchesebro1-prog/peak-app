import type { Quote, QuoteRevision, QuoteStatus } from "@/lib/stores/quotes";

/**
 * Batch 5 #59 (Jeff, 2026-10-15): "reopening a won estimate loads the version
 * that won". Pure rules; the writes are setStatus's (stores/quotes.ts).
 *
 * - At the Won transition the quote records WHICH version won in
 *   `Quote.wonRev`: the latest sent revision when the live quote still matches
 *   it (the usual case — no extra snapshot), else a new manual snapshot noted
 *   WON_SNAPSHOT_NOTE (won from a draft recalled after its last send, or never
 *   sent at all).
 * - Leaving Won for an open status (draft — a revise — or sent) puts that
 *   version back on the live quote when edits saved after the win changed it.
 *   The edits are not lost: the quote is snapshotted first (REOPEN_AUTOSAVE_NOTE),
 *   like a revision recall.
 */

export const WON_SNAPSHOT_NOTE = "Won — the version that won";
export const REOPEN_AUTOSAVE_NOTE = "Auto-saved before reopening at the version that won";
/** #355 review M8 — what Home and the Quotes hub say after such a move. */
export const REOPENED_AT_WON_NOTICE = "Reopened at the version that won — changes made after the win are saved as a revision.";

/** The priced fields a revision recall puts back (restoreQuoteRevision) — what "the version" means. */
export type WonContent = Pick<QuoteRevision, "name" | "value" | "margin" | "pricingTier" | "tierMargin" | "spec" | "flameTest" | "repair" | "inspection" | "consulting" | "rental">;

/** JSON with object keys sorted, so two equal payloads compare equal whatever their key order. */
function stable(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(",")}}`;
}

function wonContent(x: Partial<WonContent>): Record<string, unknown> {
  return {
    name: x.name ?? "",
    value: typeof x.value === "number" ? Math.round(x.value) : 0,
    margin: x.margin ?? null,
    pricingTier: x.pricingTier ?? null,
    tierMargin: x.tierMargin ?? null,
    spec: x.spec ?? null,
    flameTest: x.flameTest ?? null,
    repair: x.repair ?? null,
    inspection: x.inspection ?? null,
    consulting: x.consulting ?? null,
    rental: x.rental ?? null,
  };
}

export function wonContentKey(x: Partial<WonContent>): string {
  return stable(wonContent(x));
}

/** #367: a markup is recomputed (k = m ÷ (1 − m), engine back-solves), so a 1-ulp difference must not count. */
const MARKUP_EPS = 1e-9;
const isMarkupKey = (k: string | undefined) => !!k && /margin$/i.test(k);

/** Deep equality with `stable`'s rules (key order ignored, undefined = absent / null), except that a number under
 *  a `…margin` key (margin, tierMargin, partsMargin — markups since #367) compares within MARKUP_EPS. */
function contentEq(a: unknown, b: unknown, key?: string): boolean {
  const na = a === undefined ? null : a;
  const nb = b === undefined ? null : b;
  if (typeof na === "number" && typeof nb === "number" && isMarkupKey(key)) {
    return Number.isFinite(na) && Number.isFinite(nb) ? Math.abs(na - nb) <= MARKUP_EPS : stable(na) === stable(nb);
  }
  if (na === null || nb === null || typeof na !== "object" || typeof nb !== "object") return stable(na) === stable(nb);
  if (Array.isArray(na) !== Array.isArray(nb)) return false;
  if (Array.isArray(na)) {
    const bb = nb as unknown[];
    return na.length === bb.length && na.every((v, i) => contentEq(v, bb[i]));
  }
  const oa = na as Record<string, unknown>, ob = nb as Record<string, unknown>;
  const keys = new Set([...Object.keys(oa).filter((k) => oa[k] !== undefined), ...Object.keys(ob).filter((k) => ob[k] !== undefined)]);
  for (const k of keys) {
    if (!(k in oa) || oa[k] === undefined || !(k in ob) || ob[k] === undefined) return false;
    if (!contentEq(oa[k], ob[k], k)) return false;
  }
  return true;
}

export function sameWonContent(a: Partial<WonContent>, b: Partial<WonContent>): boolean {
  return contentEq(wonContent(a), wonContent(b));
}

/** The revision `Quote.wonRev` names, or null (never won, or a pointer to nothing). */
export function wonRevision(q: Pick<Quote, "wonRev" | "revisions">): QuoteRevision | null {
  const n = q.wonRev;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) return null;
  return (Array.isArray(q.revisions) ? q.revisions : []).find((r) => r && r.rev === n) ?? null;
}

/** Did the move from `before` to `after` put the won version back? (The
 *  Estimator then reloads — its open document holds the post-win edits.) */
export function reopenedAtWonVersion(before: Pick<Quote, "status" | "revisions"> | null, after: Pick<Quote, "revisions"> | null): boolean {
  if (!before || !after || before.status !== "won") return false;
  const n = Array.isArray(before.revisions) ? before.revisions.length : 0;
  return (Array.isArray(after.revisions) ? after.revisions : []).slice(n).some((r) => r?.reason === "manual" && r.note === REOPEN_AUTOSAVE_NOTE);
}

/** Which quotes keep a won version: Estimator system estimates, never Daylite
 *  history (service quotes run their own engine-owned won flows). */
export function tracksWonVersion(q: Pick<Quote, "quoteType" | "source">): boolean {
  return (!q.quoteType || q.quoteType === "system") && q.source !== "daylite";
}

/** A move out of Won into an open status — the "reopen" #59 is about. */
export function isReopen(from: QuoteStatus, to: QuoteStatus): boolean {
  return from === "won" && (to === "draft" || to === "sent");
}

/**
 * The version to put back when `q` (still won) moves to `to`: its won
 * revision, only when the live quote no longer matches it. `rewrite` applies
 * catalog renames made since (a live quote follows renames — #304 — so a
 * rename alone never counts as a change). Null = leave the live quote as is.
 */
export function reopenTarget(
  q: Pick<Quote, "status" | "wonRev" | "revisions"> & Partial<WonContent>,
  to: QuoteStatus,
  rewrite: (spec: unknown) => unknown = (s) => s
): QuoteRevision | null {
  if (!isReopen(q.status, to)) return null;
  const won = wonRevision(q);
  if (!won) return null;
  const spec = won.spec ? rewrite(won.spec) ?? won.spec : won.spec;
  return sameWonContent({ ...won, spec }, q) ? null : won;
}

/**
 * Estimate suggestion — the Estimator's Suggested BOM panel, as pure functions
 * (spec 2026-10-13 §2). Client-safe: the page builds the view on the server
 * (`suggestionViewOf`) and the panel derives everything else from it and the
 * estimate's current sections. Nothing here prices a line or touches a store.
 */
import type { PricePart } from "./estimate-draft";
import type { AddedSystemState, EstimateSuggestion, SuggestionSource, SuggestionSystem } from "./suggestion";

/** What the Estimator gets of a suggestion: no createdBy / run ids / header ids. */
export type EstimateSuggestionView = {
  id: string;
  /** "From email: <subject>" / "From lead …" / "From site visit …" / "From meeting …". */
  sourceLine: string;
  /** The link back to the source (the thread, lead, site visit or meeting). */
  sourceHref: string;
  notes: string;
  systems: SuggestionSystem[];
  truncated: number;
  /** True when this saved quote is already linked to the suggestion (the
   *  estsugg-quote index points at it). False on a new estimate, and on a
   *  saved quote whose first-save link didn't land — the next save retries. */
  linked: boolean;
};

/** Parts keyed by the suggestion line's own sku (getManyBySku follows renames, so `sku` may differ). */
export type SuggestionParts = Record<string, PricePart>;

const SOURCE_PREFIX: Record<SuggestionSource["kind"], string> = {
  thread: "From email",
  lead: "From lead",
  survey: "From site visit",
  meeting: "From meeting",
};

export function suggestionSourceLine(source: SuggestionSource): string {
  const label = (source.label || "").trim() || source.id;
  return `${SOURCE_PREFIX[source.kind] || "From"}: ${label}`;
}

/** The source's own page: thread → Inbox reader, lead → Leads drawer, site visit → its editor, meeting → Meetings reader. */
export function suggestionSourceHref(source: SuggestionSource): string {
  const id = encodeURIComponent(source.id);
  switch (source.kind) {
    case "thread":
      return `/inbox?thread=${id}`;
    case "lead":
      return `/leads?lead=${id}`;
    case "survey":
      return `/venue-assessments/${id}`;
    case "meeting":
      return `/inbox?view=meetings&m=${id}`;
  }
  return "";
}

export function suggestionViewOf(s: EstimateSuggestion, linked = false): EstimateSuggestionView {
  return {
    id: s.id,
    sourceLine: suggestionSourceLine(s.source),
    sourceHref: suggestionSourceHref(s.source),
    notes: s.notes || "",
    systems: s.systems,
    truncated: s.truncated > 0 ? Math.floor(s.truncated) : 0,
    linked,
  };
}

export type SuggestionLineVM = {
  key: string;
  qty: number;
  /** The live part's description when the part resolves, else the suggestion's. */
  desc: string;
  reason: string;
  added: boolean;
  /** A custom line, or a catalog line whose part is gone — it lands unpriced. */
  needsPart: boolean;
};
export type SuggestionSystemVM = {
  key: string;
  name: string;
  added: number;
  total: number;
  all: boolean;
  lines: SuggestionLineVM[];
};

/** The panel's systems: each line's ✓ added (from `addedState` over the
 *  current sections) and whether it still needs a part. */
export function suggestionPanelVM(
  view: Pick<EstimateSuggestionView, "systems">,
  state: Readonly<Record<string, AddedSystemState>>,
  parts: SuggestionParts
): SuggestionSystemVM[] {
  const lookup = new Map(Object.entries(parts));
  return view.systems.map((sys) => {
    const st = state[sys.key];
    return {
      key: sys.key,
      name: sys.name || "System",
      added: st?.added ?? 0,
      total: st?.total ?? sys.lines.length,
      all: !!st?.all,
      lines: sys.lines.map((l) => {
        const live = !l.custom && l.sku ? lookup.get(l.sku) : undefined;
        return {
          key: l.key,
          qty: l.qty,
          desc: live?.desc || l.desc || l.sku,
          reason: l.reason || "",
          added: !!st?.lines[l.key],
          needsPart: !live,
        };
      }),
    };
  });
}

/** The line "+"'s default target: the system last added from this suggestion
 *  system while it still exists, else the active system, else the first
 *  system ("" when none). */
export function defaultSuggestionTarget(
  systemKey: string,
  lastBySystem: Readonly<Record<string, string>>,
  sectionIds: readonly string[],
  activeId?: string | null
): string {
  const last = lastBySystem[systemKey];
  if (last && sectionIds.includes(last)) return last;
  if (activeId && sectionIds.includes(activeId)) return activeId;
  return sectionIds[0] || "";
}

/** localStorage key for the panel's open/closed state, per suggestion. */
export const suggestPanelKey = (suggestionId: string) => `quartzite.estimator.suggestOpen:${suggestionId}`;

/** Open on a new estimate, collapsed on a saved quote — unless this browser remembered a choice ("1"/"0"). */
export function suggestPanelOpen(stored: string | null | undefined, savedQuote: boolean): boolean {
  if (stored === "1") return true;
  if (stored === "0") return false;
  return !savedQuote;
}

/**
 * The ONE read of a suggestion's remembered open state (per suggestion id, on
 * first sight): `savedAtMount` is whether the estimate was a saved quote when
 * the Estimator mounted — never re-judged after a save gives it an id, so a
 * save can't collapse the panel mid-session. Nothing is written here: a value
 * is stored only when the user presses Hide / Show, so a quote reopened later
 * still starts hidden.
 */
export function suggestPanelFirstRead(stored: string | null | undefined, savedAtMount: boolean): boolean {
  return suggestPanelOpen(stored, savedAtMount);
}

/**
 * May a saved quote with NO linked suggestion show the URL's `?suggestion=`
 * unlinked (so its next save retries a first-save link that didn't land)?
 * Only when the suggestion is unclaimed (or already this quote's), the quote
 * was created no earlier than the suggestion, and — when the suggestion names
 * a customer — the quote is for that customer. A crafted `?id=…&suggestion=…`
 * can't attach a suggestion to an older or another customer's quote.
 */
export function unlinkedRetryAllowed(
  s: Pick<EstimateSuggestion, "quoteId" | "createdAt" | "customerId">,
  q: { id: string; createdAt?: number | null; customerId?: string | null }
): boolean {
  if (s.quoteId) return s.quoteId === q.id;
  if (typeof q.createdAt !== "number" || q.createdAt < s.createdAt) return false;
  return !s.customerId || s.customerId === (q.customerId || null);
}

/** Send the suggestion id with this save? Only until the quote is linked to
 *  it (the first save, or a retry when that link didn't land). */
export function sendSuggestionId(view: Pick<EstimateSuggestionView, "linked"> | null | undefined, linkedThisSession: boolean): boolean {
  return !!view && !view.linked && !linkedThisSession;
}

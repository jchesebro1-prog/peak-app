import { getBlob, setBlob, updateBlob } from "@/db/doc-store";
import { withTransaction } from "@/db";
import { isSuggestionId, type EstimateSuggestion, type SuggestionSystem } from "@/lib/assist/features/suggestion";
import { SUGGEST_SOURCE_KINDS, type SuggestSourceKind } from "@/lib/assist/features/suggest-sources";

/**
 * Estimate suggestions (spec 2026-10-13 §1 step 7): blobs only — no record or
 * schema changes anywhere.
 *   estsugg:<id>                     the suggestion (every key written on save)
 *   estsugg-src:<kind>:<sourceId>    { id } — the source's latest suggestion
 *   estsugg-quote:<quoteId>          { id } — the suggestion a quote was saved from
 */
export const SUGGESTION_BLOB_PREFIX = "estsugg:";
export const suggestionBlobId = (id: string) => `estsugg:${id}`;
export const sourceIndexBlobId = (kind: SuggestSourceKind, sourceId: string) => `estsugg-src:${kind}:${sourceId}`;
export const quoteIndexBlobId = (quoteId: string) => `estsugg-quote:${quoteId}`;

const REF_RE = /^[^\u0000-\u001f\u007f\s][^\u0000-\u001f\u007f]{0,159}$/;
/** A source or quote id fit for a blob key: 1–160 chars, no control chars, no leading space. */
export const isRefId = (v: unknown): v is string => typeof v === "string" && REF_RE.test(v);
const isKind = (v: unknown): v is SuggestSourceKind => typeof v === "string" && (SUGGEST_SOURCE_KINDS as readonly string[]).includes(v);

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);

/** A stored blob → a suggestion, or null when it isn't one. */
function shape(id: string, raw: Record<string, unknown>): EstimateSuggestion | null {
  if (raw.id !== id) return null;
  const src = raw.source && typeof raw.source === "object" ? (raw.source as Record<string, unknown>) : {};
  if (!isKind(src.kind)) return null;
  const by = raw.createdBy && typeof raw.createdBy === "object" ? (raw.createdBy as Record<string, unknown>) : {};
  const runs = raw.runIds && typeof raw.runIds === "object" ? (raw.runIds as Record<string, unknown>) : {};
  return {
    id,
    source: { kind: src.kind, id: str(src.id), label: str(src.label) },
    createdBy: { id: str(by.id), name: str(by.name) },
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
    customerId: strOrNull(raw.customerId),
    contactName: strOrNull(raw.contactName),
    venueId: strOrNull(raw.venueId),
    leadId: strOrNull(raw.leadId),
    quoteName: str(raw.quoteName),
    systems: Array.isArray(raw.systems) ? (raw.systems as SuggestionSystem[]).filter((s) => s && typeof s === "object" && Array.isArray(s.lines)) : [],
    notes: str(raw.notes),
    truncated: typeof raw.truncated === "number" && Number.isFinite(raw.truncated) && raw.truncated > 0 ? Math.floor(raw.truncated) : 0,
    runIds: { extract: strOrNull(runs.extract), draft: strOrNull(runs.draft) },
    quoteId: strOrNull(raw.quoteId),
  };
}

/**
 * Store a suggestion and point its source's index at it (a re-run replaces
 * the index; the older suggestion stays readable by id). Every key is written,
 * absent optionals as null, so a save fully replaces the blob.
 */
export async function saveSuggestion(s: EstimateSuggestion): Promise<void> {
  if (!isSuggestionId(s.id)) throw new Error(`Bad suggestion id: ${s.id}`);
  if (!isKind(s.source.kind) || !isRefId(s.source.id)) throw new Error("Bad suggestion source");
  const doc: Record<string, unknown> = {
    id: s.id,
    source: { kind: s.source.kind, id: s.source.id, label: s.source.label || "" },
    createdBy: { id: s.createdBy.id || "", name: s.createdBy.name || "" },
    createdAt: s.createdAt,
    customerId: s.customerId ?? null,
    contactName: s.contactName ?? null,
    venueId: s.venueId ?? null,
    leadId: s.leadId ?? null,
    quoteName: s.quoteName || "",
    systems: s.systems,
    notes: s.notes || "",
    truncated: Number.isFinite(s.truncated) && s.truncated > 0 ? Math.floor(s.truncated) : 0,
    runIds: { extract: s.runIds?.extract ?? null, draft: s.runIds?.draft ?? null },
    quoteId: s.quoteId ?? null,
  };
  await setBlob(suggestionBlobId(s.id), doc);
  await setBlob(sourceIndexBlobId(s.source.kind, s.source.id), { id: s.id });
}

export async function getSuggestion(id: string): Promise<EstimateSuggestion | null> {
  if (!isSuggestionId(id)) return null;
  return shape(id, await getBlob<Record<string, unknown>>(suggestionBlobId(id), {}));
}

/** The source's latest suggestion, or null. */
export async function suggestionForSource(kind: SuggestSourceKind, sourceId: string): Promise<EstimateSuggestion | null> {
  if (!isKind(kind) || !isRefId(sourceId)) return null;
  const idx = await getBlob<{ id?: unknown }>(sourceIndexBlobId(kind, sourceId), {});
  return isSuggestionId(idx.id) ? getSuggestion(idx.id) : null;
}

/**
 * Link a saved quote to the suggestion it was built from (first save). The
 * quote index is always written; the suggestion's own `quoteId` keeps the
 * FIRST quote (the report scores that one). False when the suggestion or
 * quote id is unusable, or the quote is already indexed to a different
 * suggestion — nothing is written then.
 */
export async function linkSuggestionToQuote(id: string, quoteId: string): Promise<boolean> {
  if (!isRefId(quoteId)) return false;
  const s = await getSuggestion(id);
  if (!s) return false;
  // #343: both checks are made under the blobs' row locks (index, then the
  // suggestion — always that order), so two quotes saved from one suggestion
  // at once can't both become "the first", and two suggestions can't both
  // claim one quote.
  return withTransaction(async () => {
    let refused = false;
    await updateBlob(quoteIndexBlobId(quoteId), (had) => {
      // A quote already indexed to a DIFFERENT suggestion keeps it (nothing written).
      refused = isSuggestionId(had.id) && had.id !== id;
      return refused ? null : { id };
    });
    if (refused) return false;
    await updateBlob(suggestionBlobId(id), (raw) => (raw.quoteId ? null : { quoteId }));
    return true;
  });
}

/** The suggestion a quote was saved from, or null. */
export async function suggestionForQuote(quoteId: string): Promise<EstimateSuggestion | null> {
  if (!isRefId(quoteId)) return null;
  const idx = await getBlob<{ id?: unknown }>(quoteIndexBlobId(quoteId), {});
  return isSuggestionId(idx.id) ? getSuggestion(idx.id) : null;
}

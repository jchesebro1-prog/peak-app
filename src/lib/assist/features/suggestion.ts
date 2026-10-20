/**
 * Estimate suggestion (spec 2026-10-13 §1 step 6, §2). Pure and client-safe:
 * the record type, the sanitizer that turns a model draft into a suggestion
 * (no prices — ever), the Estimator's "+ Add system" builder (priced ONLY
 * through the ctx's `price`, which callers pass as `catalogAddPrice`), the
 * derived "✓ added" state and the Estimator link.
 */
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { withDiscipline, sanitizeDiscipline, type ScopeDiscipline } from "@/lib/estimate-output/fields";
import type { SystemCategory, SystemFromCategoryCtx } from "@/lib/system-categories";
import type { DraftSchema, PricePart } from "./estimate-draft";
import type { SuggestSourceKind } from "./suggest-sources";
import type { z } from "zod";

export const SUGGESTION_SYSTEMS_MAX = 12;
export const SUGGESTION_LINES_MAX = 60;
export const SUGGESTION_QTY_MAX = 9999;
export const SUGGESTION_NAME_MAX = 120;
export const SUGGESTION_SYSTEM_NAME_MAX = 80;
export const SUGGESTION_DESC_MAX = 200;
export const SUGGESTION_REASON_MAX = 200;
export const SUGGESTION_NOTES_MAX = 2000;
export const SUGGESTED_NOTE = "Suggested: needs a part and price";

/** `ES-<base36>`: what a suggestion id looks like. */
export const SUGGESTION_ID_RE = /^ES-[a-z0-9]{6,40}$/;
export function isSuggestionId(v: unknown): v is string {
  return typeof v === "string" && SUGGESTION_ID_RE.test(v);
}
export function newSuggestionId(now = Date.now()): string {
  return "ES-" + now.toString(36) + Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0");
}

export type SuggestionLine = { key: string; sku: string; desc: string; qty: number; reason: string; custom: boolean };
export type SuggestionSystem = { key: string; name: string; categoryId: string; discipline?: ScopeDiscipline; lines: SuggestionLine[] };
export type SuggestionSource = { kind: SuggestSourceKind; id: string; label: string };

export type EstimateSuggestion = {
  id: string;
  source: SuggestionSource;
  createdBy: { id: string; name: string };
  createdAt: number;
  customerId: string | null;
  contactName: string | null;
  venueId: string | null;
  leadId: string | null;
  quoteName: string;
  systems: SuggestionSystem[];
  notes: string;
  /** Lines the model drafted past the caps (12 systems / 60 lines), dropped — "N more lines not shown". */
  truncated: number;
  runIds: { extract: string | null; draft: string | null };
  /** The first quote saved from this suggestion; null until then. */
  quoteId: string | null;
};

const oneLine = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim() : "";
const multiLine = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max).trimEnd() : "";

export type SanitizedSuggestion = {
  quoteName: string;
  notes: string;
  systems: SuggestionSystem[];
  /** Lines with no sku and no description, dropped. */
  dropped: number;
  /** Lines whose sku was outside the candidate set, kept as custom lines. */
  unresolved: number;
  /** Lines past the 12-system / 60-line caps, never read. */
  truncated: number;
};

/**
 * The model's draft → a suggestion's body. A line keeps its sku ONLY when it
 * is in the candidate set; otherwise it becomes a custom line described by
 * `desc` (else the stray sku text); a catalog line reads the catalog's own
 * description first. Qty is a whole number 1–9999. At most 12 systems and 60
 * lines in all (lines past the caps are counted in `truncated`); a system
 * left with no lines is dropped.
 * Every output object is built key by key — nothing the model adds (a price,
 * a cost) can ride through.
 */
export function sanitizeSuggestion(
  draft: z.infer<typeof DraftSchema> | null | undefined,
  candidates: ReadonlyArray<{ sku: string; desc?: string }>,
  categories: ReadonlyArray<Pick<SystemCategory, "id" | "name" | "discipline">> = []
): SanitizedSuggestion {
  const cand = new Map(candidates.map((c) => [c.sku, c]));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const systems: SuggestionSystem[] = [];
  let lineCount = 0;
  let dropped = 0;
  let unresolved = 0;
  let truncated = 0;
  type DraftLine = z.infer<typeof DraftSchema>["systems"][number]["lines"][number];
  const linesOf = (sys: { lines?: unknown }): DraftLine[] =>
    Array.isArray(sys.lines) ? (sys.lines as unknown[]).filter((l): l is DraftLine => !!l && typeof l === "object") : [];
  for (const sys of Array.isArray(draft?.systems) ? draft!.systems : []) {
    if (!sys || typeof sys !== "object") continue;
    const sysLines = linesOf(sys);
    if (systems.length >= SUGGESTION_SYSTEMS_MAX || lineCount >= SUGGESTION_LINES_MAX) {
      truncated += sysLines.length;
      continue;
    }
    const sysKey = `s${systems.length + 1}`;
    const lines: SuggestionLine[] = [];
    for (let i = 0; i < sysLines.length; i++) {
      if (lineCount + lines.length >= SUGGESTION_LINES_MAX) {
        truncated += sysLines.length - i;
        break;
      }
      const l = sysLines[i];
      const rawSku = typeof l.sku === "string" ? l.sku.trim() : "";
      const qty = Math.min(SUGGESTION_QTY_MAX, Math.max(1, Math.floor(Number(l.qty) || 1)));
      const reason = oneLine(l.reason, SUGGESTION_REASON_MAX);
      const hit = rawSku ? cand.get(rawSku) : undefined;
      const key = `${sysKey}-l${lines.length + 1}`;
      if (hit) {
        // The catalog's own words first: the model's desc only fills a blank one.
        const desc = oneLine(hit.desc, SUGGESTION_DESC_MAX) || oneLine(l.desc, SUGGESTION_DESC_MAX);
        lines.push({ key, sku: hit.sku, desc, qty, reason, custom: false });
        continue;
      }
      const desc = oneLine(l.desc, SUGGESTION_DESC_MAX) || oneLine(rawSku, SUGGESTION_DESC_MAX);
      if (!desc) {
        dropped++;
        continue;
      }
      if (rawSku) unresolved++;
      lines.push({ key, sku: "", desc, qty, reason, custom: true });
    }
    if (!lines.length) continue;
    const categoryId = typeof sys.categoryId === "string" ? sys.categoryId.trim() : "";
    const cat = catById.get(categoryId);
    const discipline = sanitizeDiscipline(cat?.discipline);
    systems.push({
      key: sysKey,
      name: oneLine(sys.name, SUGGESTION_SYSTEM_NAME_MAX) || oneLine(cat?.name, SUGGESTION_SYSTEM_NAME_MAX) || "System",
      categoryId: cat ? cat.id : "",
      ...(discipline ? { discipline } : {}),
      lines,
    });
    lineCount += lines.length;
  }
  return {
    quoteName: oneLine(draft?.quoteName, SUGGESTION_NAME_MAX),
    notes: multiLine(draft?.notes, SUGGESTION_NOTES_MAX),
    systems,
    dropped,
    unresolved,
    truncated,
  };
}

/** What `systemFromSuggestion` needs: the same ctx as `systemFromCategory`. */
export type SystemFromSuggestionCtx = SystemFromCategoryCtx;
type PartsLookup = ReadonlyMap<string, PricePart>;

/** One suggestion line as an Estimator line: a live part priced through
 *  `ctx.price` (catalogAddPrice at the tier), else an unpriced custom line. */
export function itemFromSuggestionLine(line: SuggestionLine, parts: PartsLookup, ctx: Pick<SystemFromSuggestionCtx, "nextId" | "tierMargin" | "price">): SpecItem {
  const part = !line.custom && line.sku ? parts.get(line.sku) : undefined;
  const qty = Math.min(SUGGESTION_QTY_MAX, Math.max(1, Math.floor(Number(line.qty) || 1)));
  if (part) {
    const cost = part.cost || 0;
    return { id: ctx.nextId(), sku: part.sku, desc: part.desc, qty, unit: part.unit || "ea", cost, price: ctx.price(cost, part.list || 0, ctx.tierMargin) };
  }
  return { id: ctx.nextId(), sku: "", desc: line.desc || line.sku, qty, unit: "ea", cost: 0, price: 0, custom: true, internalNote: SUGGESTED_NOTE };
}

/**
 * "+ Add system" on a suggestion system: a new system named after it, joining
 * the active group, with every line built like "+ Add part from catalog"
 * (sell = `price(cost, list, tierMargin)`) — a line whose part is gone (or a
 * custom line) lands as an unpriced custom line flagged "Suggested: needs a
 * part and price". Mirrors `systemFromCategory`.
 */
export function systemFromSuggestion(system: SuggestionSystem, parts: PartsLookup, ctx: SystemFromSuggestionCtx): SpecSection {
  const id = "sys" + ctx.nextId();
  const items = system.lines.map((l) => itemFromSuggestionLine(l, parts, ctx));
  const base: SpecSection = {
    id,
    name: system.name || "System",
    kind: "materials",
    mfr: "",
    freightPct: ctx.freightPct,
    freightAuto: true,
    priceRound: ctx.priceRound,
    ...(ctx.presentation ? { presentation: ctx.presentation } : {}),
    items,
    ...(ctx.groupId ? { groupId: ctx.groupId } : {}),
  };
  return withDiscipline(base, system.discipline);
}

const normDesc = (s: string | undefined) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

export type AddedSystemState = { lines: Record<string, boolean>; added: number; total: number; all: boolean };

/**
 * "✓ added", derived from the estimate as it stands — nothing is stored. A
 * catalog line is added when any line in any system carries its sku (or the
 * live sku it resolves to, after a rename); a custom line — or a catalog line
 * whose part is gone, which lands as custom — matches by description.
 */
export function addedState(
  suggestion: Pick<EstimateSuggestion, "systems">,
  sections: ReadonlyArray<Pick<SpecSection, "items">>,
  parts?: PartsLookup
): Record<string, AddedSystemState> {
  const skus = new Set<string>();
  const descs = new Set<string>();
  for (const sec of sections) {
    for (const it of sec.items || []) {
      if (it.sku) skus.add(it.sku);
      const d = normDesc(it.desc);
      if (d) descs.add(d);
    }
  }
  const out: Record<string, AddedSystemState> = {};
  for (const sys of suggestion.systems) {
    const lines: Record<string, boolean> = {};
    let added = 0;
    for (const l of sys.lines) {
      const live = l.sku ? parts?.get(l.sku) : undefined;
      const byDesc = l.custom || !l.sku || (parts !== undefined && !live);
      const hit = (!!l.sku && !l.custom && (skus.has(l.sku) || (!!live && skus.has(live.sku)))) || (byDesc && descs.has(normDesc(l.desc || l.sku)));
      lines[l.key] = hit;
      if (hit) added++;
    }
    out[sys.key] = { lines, added, total: sys.lines.length, all: sys.lines.length > 0 && added === sys.lines.length };
  }
  return out;
}

/** The Estimator link a suggestion opens: header-only hand-off (spec §1 step 8). */
export function suggestionHref(s: Pick<EstimateSuggestion, "id" | "customerId" | "venueId" | "contactName" | "leadId">): string {
  const p = new URLSearchParams();
  p.set("suggestion", s.id);
  if (s.customerId) p.set("customer", s.customerId);
  if (s.venueId) p.set("venue", s.venueId);
  if (s.contactName) p.set("contact", s.contactName);
  if (s.leadId) p.set("lead", s.leadId);
  return "/estimator?" + p.toString();
}

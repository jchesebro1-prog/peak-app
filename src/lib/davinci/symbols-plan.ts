import { mfrKey } from "@/lib/catalog-books";
import { peakMfrFor } from "@/lib/catalog-davinci-apply";
import { buildIndexWithStats, matchSku } from "./match";
import type { DavinciExtract } from "./types";

/**
 * DaVinci drawings → `symbol` / `riser` part documents (#300 slice 3, spec §3,
 * D610–D611) — the pure planning half of `npm run symbols:davinci`.
 *
 * Matching is the #162/#207 rule exactly: `buildIndexWithStats` over the
 * extract, `matchSku` on the Peak SKU, and the manufacturer gate
 * (`peakMfrFor(record)` must equal the part's own `mfr`, compared with
 * `mfrKey`) — SKU alone is not brand-aware (Draper "450" → ETC "450").
 *
 * The plan never replaces a drawing a person put on a part: a live drawing of
 * the same kind whose source is not "davinci" wins, and a DaVinci drawing a
 * person detached is never re-attached. A live DaVinci drawing with the same
 * image id is already there; one with a different image id is an older
 * library revision and is replaced (attachDocument's one-current rule).
 */

export type SymbolImportCandidate = {
  partSku: string;
  kind: "symbol" | "riser";
  /** DaVinci image id — lower-case, no braces (extract.ts). */
  imageId: string;
  typeId: string;
  /** The DaVinci type's name — the document title is "DaVinci <displayName>". */
  displayName: string;
};

export type ExistingSymbol = {
  partSku: string;
  kind: "symbol" | "riser";
  source: string;
  sourceRef?: string;
  /** A soft-deleted (detached) link — a person took this drawing off the part. */
  detached?: boolean;
};

export type SymbolSkipReason =
  /** The image file isn't in the local DaVinci export (browse more of the library, re-export). */
  | "not-downloaded"
  /** This exact DaVinci drawing is already the part's current one. */
  | "already-present"
  /** The part's current drawing of this kind was put there by a person — never replaced. */
  | "hand-uploaded"
  /** A person detached this exact DaVinci drawing from the part — never re-attached. */
  | "removed";

export type SymbolImportPlan = {
  attach: SymbolImportCandidate[];
  skipped: { reason: SymbolSkipReason; c: SymbolImportCandidate }[];
};

const slot = (partSku: string, kind: string) => `${partSku}\u0000${kind}`;

export function planSymbolImport(
  candidates: readonly SymbolImportCandidate[],
  onDisk: ReadonlySet<string>,
  existing: readonly ExistingSymbol[]
): SymbolImportPlan {
  const live = new Map<string, ExistingSymbol[]>();
  const detachedDavinci = new Set<string>();
  for (const e of existing) {
    const key = slot(e.partSku, e.kind);
    if (e.detached) {
      if (e.source === "davinci" && e.sourceRef) detachedDavinci.add(`${key}\u0000${e.sourceRef}`);
      continue;
    }
    const list = live.get(key);
    if (list) list.push(e);
    else live.set(key, [e]);
  }
  const plan: SymbolImportPlan = { attach: [], skipped: [] };
  for (const c of candidates) {
    if (!onDisk.has(c.imageId)) {
      plan.skipped.push({ reason: "not-downloaded", c });
      continue;
    }
    const key = slot(c.partSku, c.kind);
    const current = live.get(key) ?? [];
    if (current.some((e) => e.source !== "davinci")) {
      plan.skipped.push({ reason: "hand-uploaded", c });
      continue;
    }
    if (current.some((e) => e.sourceRef === c.imageId)) {
      plan.skipped.push({ reason: "already-present", c });
      continue;
    }
    if (detachedDavinci.has(`${key}\u0000${c.imageId}`)) {
      plan.skipped.push({ reason: "removed", c });
      continue;
    }
    // No drawing, or an older DaVinci drawing (different image id) — attach; the
    // one-current rule detaches the older one.
    plan.attach.push(c);
  }
  return plan;
}

/**
 * One candidate per (part, kind) whose matched DaVinci type carries an image
 * id. `catalog` is every catalog row; the manufacturer gate scopes it.
 */
export function candidatesFor(
  extract: DavinciExtract,
  catalog: ReadonlyArray<{ id: string; sku: string; manufacturer?: string }>
): SymbolImportCandidate[] {
  const { index } = buildIndexWithStats(extract.records);
  const out: SymbolImportCandidate[] = [];
  const seen = new Set<string>();
  for (const p of catalog) {
    const rec = matchSku(p.sku, index);
    if (!rec) continue;
    const allowed = peakMfrFor(rec);
    if (!allowed || mfrKey(allowed) !== mfrKey(p.manufacturer)) continue;
    const pairs: Array<["symbol" | "riser", string | undefined]> = [
      ["symbol", rec.planImageId],
      ["riser", rec.riserImageId],
    ];
    for (const [kind, imageId] of pairs) {
      if (!imageId) continue;
      const key = slot(p.sku, kind);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ partSku: p.sku, kind, imageId, typeId: rec.typeId, displayName: rec.displayName });
    }
  }
  return out;
}

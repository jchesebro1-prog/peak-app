/**
 * The Grid — options (Spec 1, 2026-09-21). An option is a first-class
 * variant of one design: its own placements + wire routes, BOM and quote,
 * on the project's SHARED sheets/calibration/spaces. Good/Better/Best are
 * three options; a hand-made design is one option.
 *
 * Storage is a TAG, not nesting: `placements[]`/`routes[]` stay flat on the
 * project and each member carries `optionId`. Pre-spec docs have neither
 * an `options` list nor tags — `ensureOptions` normalizes them in memory
 * (one "Design" option, untagged members belong to it). The stored doc is
 * only rewritten when a later option-aware patch runs `ensureOptions` on it.
 *
 * Pure and dependency-free (the grid-bom.ts rule): imported by the store,
 * the server actions, the riser/schedule pages AND the client editor.
 */

import type { TierKey } from "@/app/(app)/design/quick/engine";

export type GridOption = {
  id: string; // 'opt-' + 12 hex, or DEFAULT_OPTION_ID for a normalized legacy doc
  name: string;
  /** Set by the Auto generator (Spec 2). Absent on hand-made options. */
  tier?: TierKey;
  /** Draft quote minted from THIS option, when one exists. */
  quoteId: string | null;
  createdAt: number;
};

export const DEFAULT_OPTION_ID = "opt-base";
export const DEFAULT_OPTION_NAME = "Design";

type Member = { optionId?: string };

export type OptionsDoc = {
  options?: GridOption[];
  placements?: Member[];
  routes?: Member[];
  quoteId?: string | null;
  createdAt?: number;
};

/**
 * Normalize IN PLACE and return the same object: guarantees ≥1 option and
 * a tag on every member. Idempotent. Safe on a freshly-read doc (nothing
 * else holds it) and inside a patch callback (where the mutation is the
 * point).
 */
export function ensureOptions<T extends OptionsDoc>(doc: T): T & { options: GridOption[] } {
  let options = Array.isArray(doc.options) ? doc.options : [];
  if (options.length === 0) {
    options = [
      {
        id: DEFAULT_OPTION_ID,
        name: DEFAULT_OPTION_NAME,
        quoteId: doc.quoteId ?? null,
        createdAt: doc.createdAt ?? Date.now(),
      },
    ];
  }
  doc.options = options;
  const first = options[0].id;
  const known = new Set(options.map((o) => o.id));
  for (const pl of doc.placements || []) {
    if (!pl.optionId || !known.has(pl.optionId)) pl.optionId = first;
  }
  for (const r of doc.routes || []) {
    if (!r.optionId || !known.has(r.optionId)) r.optionId = first;
  }
  return doc as T & { options: GridOption[] };
}

export function defaultOptionId(doc: OptionsDoc): string {
  return ensureOptions(doc).options[0].id;
}

export function hasOption(doc: OptionsDoc, optionId: string): boolean {
  return ensureOptions(doc).options.some((o) => o.id === optionId);
}

/** A requested id (e.g. from `?option=`) if it exists, else the first option. */
export function resolveOptionId(doc: OptionsDoc, requested: string | null | undefined): string {
  if (requested && hasOption(doc, requested)) return requested;
  return defaultOptionId(doc);
}

/** The members of one option. The result arrays are new; the members are not copied. */
export function optionSlice<P extends Member, R extends Member>(
  doc: { placements?: P[]; routes?: R[] } & OptionsDoc,
  optionId: string
): { placements: P[]; routes: R[] } {
  ensureOptions(doc);
  return {
    placements: (doc.placements || []).filter((p) => p.optionId === optionId),
    routes: (doc.routes || []).filter((r) => r.optionId === optionId),
  };
}

/** `project.quoteId` stays a mirror of the FIRST option's quote so every
 *  pre-spec reader (Designs dashboard, Quotes hub back-links) keeps working. */
export function syncQuoteMirror<T extends OptionsDoc>(doc: T): T {
  const opts = ensureOptions(doc).options;
  doc.quoteId = opts[0]?.quoteId ?? null;
  return doc;
}

/**
 * Deep-copy one option's members into another option with NEW ids, remapping
 * device-wire endpoints (`fromPlacementId`/`toPlacementId`) onto the copied
 * placements. Never mutates the inputs.
 */
export function copyOptionMembers<
  P extends { id: string; optionId?: string },
  R extends { id: string; optionId?: string; fromPlacementId?: string; toPlacementId?: string },
>(input: {
  placements: P[];
  routes: R[];
  fromOptionId: string;
  toOptionId: string;
  makeId: (prefix: "gp-" | "wr-") => string;
  by: string;
  at: number;
}): { placements: P[]; routes: R[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  const placements = input.placements
    .filter((p) => p.optionId === input.fromOptionId)
    .map((p) => {
      const id = input.makeId("gp-");
      idMap.set(p.id, id);
      return { ...p, id, optionId: input.toOptionId, by: input.by, at: input.at } as P;
    });
  const routes = input.routes
    .filter((r) => r.optionId === input.fromOptionId)
    .map((r) => {
      const next = { ...r, id: input.makeId("wr-"), optionId: input.toOptionId, by: input.by, at: input.at } as R;
      if (r.fromPlacementId) {
        const m = idMap.get(r.fromPlacementId);
        if (m) next.fromPlacementId = m; else delete next.fromPlacementId;
      }
      if (r.toPlacementId) {
        const m = idMap.get(r.toPlacementId);
        if (m) next.toPlacementId = m; else delete next.toPlacementId;
      }
      return next;
    });
  // idMap (old placement id → copied id) lets the caller re-point anything
  // else that references devices — the riser document's links (#GDS).
  return { placements, routes, idMap };
}

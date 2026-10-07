/**
 * #304 — pure per-area reference rewriters. A catalog rename moves a part's
 * SKU ("80-0043" → "Symetrix:Jupiter 4"); every place that stores a SKU as a
 * plain string must follow it. Each function here knows ONE area's real
 * shape, walks only that area's SKU fields (never a deep string replace — a
 * description or note that happens to read "80-0043" stays as written) and
 * has the same contract:
 *
 *   - `m` is old SKU → new SKU;
 *   - the result is `null` when nothing changed, otherwise a NEW value — the
 *     input is never mutated (unchanged subtrees are shared with it, so a
 *     caller must treat the output as read-only too);
 *   - frozen data (quote / Grid `revisions`, generated specs, spec record
 *     revisions, the `settings.fixtureAssemblies` backup) is not an area here
 *     and is never passed in.
 *
 * No DB or store runtime imports: Task 4's rename runner reads the rows and
 * calls these, so this file stays client-safe.
 */

export type RenameMap = ReadonlyMap<string, string>;

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

/** The renamed SKU, or undefined when `s` is not a string or has no rename. */
const moved = (m: RenameMap, s: unknown): string | undefined => (typeof s === "string" ? m.get(s) : undefined);

/** Copy-on-write element map: null when no element changed. `fn` returns the
 *  replacement for an element or null to keep it. */
function mapList<T>(list: readonly T[], fn: (x: T) => T | null): T[] | null {
  let out: T[] | null = null;
  list.forEach((x, i) => {
    const next = fn(x);
    if (next === null) return;
    out ??= list.slice();
    out[i] = next;
  });
  return out;
}

/** mapList over the object elements of an unknown array; other elements pass through. */
function mapObjs(list: unknown, fn: (o: Rec) => Rec | null): unknown[] | null {
  return Array.isArray(list) ? mapList<unknown>(list, (x) => (isRec(x) ? fn(x) : null)) : null;
}

/** Copy-on-write value map over an object's own entries: null when no value changed. */
function mapValues(rec: Rec, fn: (v: unknown) => unknown | null): Rec | null {
  let out: Rec | null = null;
  for (const [k, v] of Object.entries(rec)) {
    const next = fn(v);
    if (next === null) continue;
    out ??= { ...rec };
    out[k] = next;
  }
  return out;
}

/** Just the listed string fields of `o` that moved, as a patch (empty = none). */
function fieldPatch(o: Rec, keys: readonly string[], m: RenameMap): Rec {
  const patch: Rec = {};
  for (const k of keys) {
    const to = moved(m, o[k]);
    if (to !== undefined) patch[k] = to;
  }
  return patch;
}

/** Overlay `patch` onto `o` when it has anything in it, else null. */
const overlay = (o: Rec, patch: Rec): Rec | null => (Object.keys(patch).length ? { ...o, ...patch } : null);

/** `o` with each listed string field moved to its new SKU, or null when none moved. */
const swapFields = (o: Rec, keys: readonly string[], m: RenameMap): Rec | null => overlay(o, fieldPatch(o, keys, m));

/**
 * Add-on quantities keyed `slot:sku` (a fixture line's `fixtureOptions`, on a
 * portal cart line and on the Estimator line it priced into). The slot is a
 * fixed identifier — `lightEngine`, `lens`, one of the four FixtureBox names,
 * `parts` or `rack` (`fixtureOptionKey`, portal-part-view.ts) — so it never
 * holds a `:`; the SKU is everything after the FIRST colon, and new
 * `Brand:Model` SKUs hold one of their own. Two keys landing on one new key
 * (the old SKU and the new one both present) sum their quantities.
 */
export function rewriteSkuKeyed(rec: Record<string, number>, m: RenameMap): Record<string, number> | null {
  if (!isRec(rec)) return null;
  let changed = false;
  const out: Record<string, number> = {};
  for (const [key, qty] of Object.entries(rec)) {
    const i = key.indexOf(":");
    const to = i >= 0 ? m.get(key.slice(i + 1)) : undefined;
    const next = to === undefined ? key : `${key.slice(0, i + 1)}${to}`;
    if (to !== undefined) changed = true;
    if (Object.hasOwn(out, next)) out[next] += qty;
    else out[next] = qty;
  }
  return changed ? out : null;
}

/** The SKU-bearing fields a priced line and a cart line share: `sku`,
 *  `fixtureOptions` keys, `curtainInputs.fabricSku`. Returns the patch (empty = nothing). */
function lineRefPatch(line: Rec, m: RenameMap): Rec {
  const patch = fieldPatch(line, ["sku"], m);
  if (isRec(line.fixtureOptions)) {
    const opts = rewriteSkuKeyed(line.fixtureOptions as Record<string, number>, m);
    if (opts) patch.fixtureOptions = opts;
  }
  if (isRec(line.curtainInputs)) {
    const fabric = swapFields(line.curtainInputs, ["fabricSku"], m);
    if (fabric) patch.curtainInputs = fabric;
  }
  return patch;
}

type SpecItemShape = {
  sku?: string;
  manufacturerModelNumber?: string;
  components?: Array<{ sku: string }>;
  fixtureOptions?: Record<string, number>;
  curtainInputs?: { fabricSku?: string };
};

/**
 * Estimator `SpecItem`s (a section's `items`): `sku`, `components[].sku`,
 * `fixtureOptions` keys and `curtainInputs.fabricSku`. A line whose OWN sku
 * moved also gets `manufacturerModelNumber` = `models.get(newSku)` when that
 * model is known — the customer document prints it (`partModel`). A line that
 * only carries a renamed component keeps its own model.
 */
export function rewriteSpecItems<T extends SpecItemShape>(items: T[], m: RenameMap, models: RenameMap): T[] | null {
  if (!Array.isArray(items)) return null;
  return mapList(items, (item) => {
    if (!isRec(item)) return null;
    const patch = lineRefPatch(item, m);
    if (typeof patch.sku === "string") {
      const model = models.get(patch.sku);
      if (model) patch.manufacturerModelNumber = model;
    }
    const components = mapObjs(item.components, (c) => swapFields(c, ["sku"], m));
    if (components) patch.components = components;
    return overlay(item, patch) as T | null;
  });
}

/** A quote's `spec`: each section's `items` and `keyProducts[].sku` (a key
 *  product resolves only while it still matches its line's sku, so both move
 *  together), and a Grid quote's flat `lines[].sku` (`source: "grid"`,
 *  GridQuoteSpecLine in grid-quote.ts — the placement's partId; "CURTAIN" and
 *  the virtual `asm:` / `allow:` ids are never renamed SKUs, so they pass
 *  through; the line has no model field to set). The section/spec envelope
 *  and every other field carry over. */
export function rewriteQuoteSpec(spec: unknown, m: RenameMap, models: RenameMap): unknown | null {
  if (!isRec(spec)) return null;
  const patch: Rec = {};
  const sections = mapObjs(spec.sections, (section) => {
    const sp: Rec = {};
    if (Array.isArray(section.items)) {
      const items = rewriteSpecItems(section.items as SpecItemShape[], m, models);
      if (items) sp.items = items;
    }
    const keyProducts = mapObjs(section.keyProducts, (kp) => swapFields(kp, ["sku"], m));
    if (keyProducts) sp.keyProducts = keyProducts;
    return overlay(section, sp);
  });
  if (sections) patch.sections = sections;
  const lines = mapObjs(spec.lines, (ln) => swapFields(ln, ["sku"], m));
  if (lines) patch.lines = lines;
  return overlay(spec, patch);
}

/** A portal cart's `lines` (CartLine): `sku`, `fixtureOptions` keys, `curtainInputs.fabricSku`. `fixtureId` is an assembly id, not a SKU. */
export function rewriteCartLines(lines: unknown, m: RenameMap): unknown | null {
  return mapObjs(lines, (line) => overlay(line, lineRefPatch(line, m)));
}

/** A project's `procurement` rows (ProcurementLine): `sku`. */
export function rewriteProcurement(rows: unknown, m: RenameMap): unknown | null {
  return mapObjs(rows, (row) => swapFields(row, ["sku"], m));
}

/** A spec document's `products` (SpecDocProduct): `sku`. `mfrNumber` is the manufacturer part number, not the SKU. */
export function rewriteSpecDocProducts(products: unknown, m: RenameMap): unknown | null {
  return mapObjs(products, (p) => swapFields(p, ["sku"], m));
}

const FIXTURE_HEAD_SKUS = ["lightEngineSku", "lensSku"] as const;

/**
 * A `subassemblies` record (FixtureRecord): `lightEngineSku`, `lensSku`,
 * `lines.<box>[].sku` and `parts[].sku`; for a rack also `rack.placements[].sku`
 * (the RU layout lives under the record's `rack`, not at its top level).
 */
export function rewriteSubassembly(doc: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null {
  if (!isRec(doc)) return null;
  const patch = fieldPatch(doc, FIXTURE_HEAD_SKUS, m);
  if (isRec(doc.lines)) {
    const lines = mapValues(doc.lines, (box) => mapObjs(box, (l) => swapFields(l, ["sku"], m)));
    if (lines) patch.lines = lines;
  }
  const parts = mapObjs(doc.parts, (l) => swapFields(l, ["sku"], m));
  if (parts) patch.parts = parts;
  if (isRec(doc.rack)) {
    const placements = mapObjs(doc.rack.placements, (p) => swapFields(p, ["sku"], m));
    if (placements) patch.rack = { ...doc.rack, placements };
  }
  return overlay(doc, patch);
}

/** One Auto estimate: `overrides[rowKey].sku`. (`assemblyId` is an assembly id.) */
function rewriteAutoEstimate(est: unknown, m: RenameMap): Rec | null {
  if (!isRec(est) || !isRec(est.overrides)) return null;
  const overrides = mapValues(est.overrides, (o) => (isRec(o) ? swapFields(o, ["sku"], m) : null));
  return overrides ? { ...est, overrides } : null;
}

/**
 * A Grid project's LIVE fields — `placements[].partId` (a curtain placement's
 * `partId` IS its fabric SKU) and `placements[].curtain.fabricSku`,
 * `routes[].partId`, `riser[optionId].links[].partId`,
 * `options[].accessories[].partId`, and `autoEstimate` overrides' `sku`
 * (per-option map, or the pre-D312 bare estimate). `revisions` are frozen
 * snapshots: never touched.
 */
export function rewriteGridProjectLive(doc: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null {
  if (!isRec(doc)) return null;
  const patch: Rec = {};
  const placements = mapObjs(doc.placements, (p) => {
    const next = fieldPatch(p, ["partId"], m);
    if (isRec(p.curtain)) {
      const curtain = swapFields(p.curtain, ["fabricSku"], m);
      if (curtain) next.curtain = curtain;
    }
    return overlay(p, next);
  });
  if (placements) patch.placements = placements;
  const routes = mapObjs(doc.routes, (r) => swapFields(r, ["partId"], m));
  if (routes) patch.routes = routes;
  if (isRec(doc.riser)) {
    const riser = mapValues(doc.riser, (rd) => {
      if (!isRec(rd)) return null;
      const links = mapObjs(rd.links, (l) => swapFields(l, ["partId"], m));
      return links ? { ...rd, links } : null;
    });
    if (riser) patch.riser = riser;
  }
  const options = mapObjs(doc.options, (o) => {
    const accessories = mapObjs(o.accessories, (a) => swapFields(a, ["partId"], m));
    return accessories ? { ...o, accessories } : null;
  });
  if (options) patch.options = options;
  if (isRec(doc.autoEstimate)) {
    const ae = doc.autoEstimate;
    const next = "tierByScope" in ae || "overrides" in ae ? rewriteAutoEstimate(ae, m) : mapValues(ae, (e) => rewriteAutoEstimate(e, m));
    if (next) patch.autoEstimate = next;
  }
  return overlay(doc, patch);
}

/** A `grid_catalog` symbol: `members[].symbolId` (an assembly's parts — symbol ids are catalog SKUs for catalog-made symbols) and the `pricingPartId` bridge to the catalog. The symbol's own `id` is a doc key, not rewritten here. */
export function rewriteGridSymbolMembers(doc: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null {
  if (!isRec(doc)) return null;
  const patch = fieldPatch(doc, ["pricingPartId"], m);
  const members = mapObjs(doc.members, (mem) => swapFields(mem, ["symbolId"], m));
  if (members) patch.members = members;
  return overlay(doc, patch);
}

/** The `grid_equipment_map` blob (rowKey → row): each tier cell of kind `part` carries a `sku`; assembly / allowance / none cells carry none. */
export function rewriteEquipmentMap(blob: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null {
  if (!isRec(blob)) return null;
  return mapValues(blob, (row) => {
    if (!isRec(row) || !isRec(row.tiers)) return null;
    const tiers = mapValues(row.tiers, (cell) => (isRec(cell) && cell.kind === "part" ? swapFields(cell, ["sku"], m) : null));
    return tiers ? { ...row, tiers } : null;
  });
}

/** The `track_series` blob (seriesId → TrackSeries): `parts[role].sku` and `sticks[].sku`. */
export function rewriteTrackSeries(blob: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null {
  if (!isRec(blob)) return null;
  return mapValues(blob, (series) => {
    if (!isRec(series)) return null;
    const patch: Rec = {};
    if (isRec(series.parts)) {
      const parts = mapValues(series.parts, (p) => (isRec(p) ? swapFields(p, ["sku"], m) : null));
      if (parts) patch.parts = parts;
    }
    const sticks = mapObjs(series.sticks, (s) => swapFields(s, ["sku"], m));
    if (sticks) patch.sticks = sticks;
    return overlay(series, patch);
  });
}

/** The `curtain_mount_hardware` blob: `rows[].sku`. */
export function rewriteCurtainMounts(blob: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null {
  if (!isRec(blob)) return null;
  const rows = mapObjs(blob.rows, (r) => swapFields(r, ["sku"], m));
  return rows ? { ...blob, rows } : null;
}

/** The `rack_defaults` blob: `blankSku` and `ventSku`. */
export function rewriteRackDefaults(blob: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null {
  return isRec(blob) ? swapFields(blob, ["blankSku", "ventSku"], m) : null;
}

/** A per-user Grid favorites / recent blob, `{ ids: string[] }`: ids move, and a list holding both the old and the new id keeps one (the earlier position). */
export function rewriteIdList(blob: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null {
  if (!isRec(blob) || !Array.isArray(blob.ids)) return null;
  const ids = dedupeMoved(blob.ids, m);
  return ids ? { ...blob, ids } : null;
}

/** Strings through the rename map; null when none moved. A moved id colliding with one already in the list is dropped. */
function dedupeMoved(list: readonly unknown[], m: RenameMap): unknown[] | null {
  let changed = false;
  const seen = new Set<unknown>();
  const out: unknown[] = [];
  for (const x of list) {
    const to = moved(m, x);
    if (to !== undefined) changed = true;
    const next = to ?? x;
    if (typeof next === "string") {
      if (seen.has(next)) {
        changed = true;
        continue;
      }
      seen.add(next);
    }
    out.push(next);
  }
  return changed ? out : null;
}

/** The `drive_photo_sync` blob: `files[fileId].skus[]` (deduped after the move). `lastRun` history is a log of what happened and stays as written. */
export function rewriteDrivePhotoSync(blob: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null {
  if (!isRec(blob) || !isRec(blob.files)) return null;
  const files = mapValues(blob.files, (f) => {
    if (!isRec(f) || !Array.isArray(f.skus)) return null;
    const skus = dedupeMoved(f.skus, m);
    return skus ? { ...f, skus } : null;
  });
  return files ? { ...blob, files } : null;
}

/** `settings.wireTypes` (WireType[]): `cableSku`. */
export function rewriteWireTypes(wireTypes: unknown, m: RenameMap): unknown | null {
  return mapObjs(wireTypes, (w) => swapFields(w, ["cableSku"], m));
}

/** A catalog part's references to OTHER parts: `specSameAs` and `productMetadata.accessories[].sku`. The part's own `sku` is the rename's own write, not this rewriter's. */
export function rewritePartRefs(part: Record<string, unknown>, m: RenameMap): Record<string, unknown> | null {
  if (!isRec(part)) return null;
  const patch = fieldPatch(part, ["specSameAs"], m);
  if (isRec(part.productMetadata)) {
    const accessories = mapObjs(part.productMetadata.accessories, (a) => swapFields(a, ["sku"], m));
    if (accessories) patch.productMetadata = { ...part.productMetadata, accessories };
  }
  return overlay(part, patch);
}

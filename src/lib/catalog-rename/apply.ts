// SERVER ONLY — the #302 catalog rename engine (reads and writes the database; never import from a client component).
/**
 * #302 — apply a model-number crosswalk: rename the parts, then rewrite every
 * live reference to the old SKUs. One call does at most ONE step and stops
 * between writes once `budgetMs` (FETCH_ACTION_BUDGET_MS, passed in by the
 * action) is spent; the client calls again with the step it was handed back.
 *
 *   parts → parts-refs → doc-links → accessory-links → quotes → projects →
 *   portal-carts → spec-documents → subassemblies → grid-symbols →
 *   grid-projects → blobs → done
 *
 * Every step is idempotent: the parts step re-plans from the sheet each call
 * (rows already renamed plan as `already`), and each reference step re-scans
 * its whole area against the WHOLE rename log (`catalog_sku_renames`), so a
 * resumed or repeated run only writes what still says an old SKU — and a
 * "Fix references" run (refsOnly) picks up stragglers from earlier renames.
 *
 * Frozen data is never an area here: quote and Grid `revisions`,
 * generated_specs, spec_record_revisions and the settings.fixtureAssemblies
 * backup keep the old SKU and resolve through the catalog's renamedTo
 * redirect. Rewrites are the pure per-area functions in ./rewrite; each write
 * re-runs its rewriter on the doc read inside the write (patchDoc / the
 * quote store's row-locked writer), so a concurrent edit is not overwritten
 * with a stale copy.
 */
import {
  getBlob,
  getDoc,
  getDocRows,
  insertDocsIfAbsent,
  listBlobIds,
  listDeletedDocs,
  listDocs,
  patchDoc,
  setBlob,
  softDeleteDoc,
  softDeleteDocs,
  upsertDoc,
  type Doc,
} from "@/db/doc-store";
import type { CollectionName } from "@/db/doc-tables";
import { CURTAIN_MOUNTS_BLOB } from "@/lib/curtain-mounts";
import { favoritesBlobId, recentBlobId } from "@/lib/design/device-types";
import { EQUIPMENT_MAP_BLOB } from "@/lib/design/equipment-map";
import { DRIVE_PHOTO_SYNC_BLOB } from "@/lib/part-docs/drive-photo-sync";
import type { PartAccessoryLink, PartDocumentLink } from "@/lib/part-docs/types";
import { RACK_DEFAULTS_BLOB } from "@/lib/rack/defaults";
import { getSettingsPatchStrict, setSettings } from "@/lib/settings";
import { list as listCatalog, renamePartDocs, type CatalogPart } from "@/lib/stores/catalog";
import { allSkuRenames, appendSkuRenames, liveRenameRefs, renameMapOf, type SkuRename } from "@/lib/stores/catalog-renames";
import { accessoryLinkId, allAccessoryLinks } from "@/lib/stores/part-accessory-links";
import { allDocumentLinks, documentLinkId } from "@/lib/stores/part-documents";
import { markQuotePdfStale } from "@/lib/quote-pdf/schedule";
import { rewriteQuoteSpecRefs } from "@/lib/stores/quotes";
import { TRACK_SERIES_BLOB } from "@/lib/track-series";
import { CROSSWALK_CELL_MAX, CROSSWALK_MAX_ROWS, planRenames, type CrosswalkRow, type PlanPart, type RenamePlan } from "./plan";
import * as RW from "./rewrite";

export const REF_STEPS = [
  "parts-refs",
  "doc-links",
  "accessory-links",
  "quotes",
  "projects",
  "portal-carts",
  "spec-documents",
  "subassemblies",
  "grid-symbols",
  "grid-projects",
  "blobs",
] as const;
export type RefStep = (typeof REF_STEPS)[number];
export type RenameStep = "parts" | RefStep | "done";
export type RenameBatchInput = { rows: CrosswalkRow[]; step: RenameStep; refsOnly?: boolean };
export type RenameBatchResult =
  | { ok: true; step: RenameStep; complete: boolean; renamed: number; changed: number; plan: RenamePlan | null }
  | { ok: false; error: string };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

/** Renames applied per log append in the parts step. */
const PARTS_CHUNK = 50;
/** Link rows re-keyed per insert/retire pair. */
const LINK_CHUNK = 200;

/** What the planner needs: the live book (sku, mfr, former SKUs) and the
 *  retired SKUs that point somewhere (`renamedTo`). Reads the whole book once. */
export async function loadPlanContext(): Promise<{ live: PlanPart[]; retired: Array<{ sku: string; renamedTo?: string }> }> {
  const [live, deleted] = await Promise.all([listCatalog(), listDeletedDocs<CatalogPart>("catalog_parts")]);
  return {
    live: live.map((p) => ({ sku: p.sku, mfr: p.mfr, formerSkus: p.formerSkus })),
    retired: deleted.filter((p) => !!p.renamedTo).map((p) => ({ sku: p.sku || p.id, renamedTo: p.renamedTo })),
  };
}

/** Client rows are untrusted: capped, every cell a trimmed string ≤ the sheet's cell cap. */
function cleanRows(raw: unknown): CrosswalkRow[] | null {
  if (!Array.isArray(raw) || raw.length > CROSSWALK_MAX_ROWS) return null;
  const s = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "").trim().slice(0, CROSSWALK_CELL_MAX);
  return raw.filter(isRec).map((r, i) => ({
    rowNumber: Number.isSafeInteger(r.rowNumber) ? (r.rowNumber as number) : i + 2,
    manufacturer: s(r.manufacturer),
    mfrPart: s(r.mfrPart),
    sku: s(r.sku),
    model: s(r.model),
    notes: s(r.notes),
  }));
}

type Ctx = {
  /** old SKU → the SKU it ended up as (the whole log, chains collapsed). */
  m: ReadonlyMap<string, string>;
  /** final SKU → its model (what a renamed quote line prints). */
  models: ReadonlyMap<string, string>;
  over: () => boolean;
};
type StepOut = { done: boolean; changed: number };

async function refContext(over: () => boolean): Promise<Ctx> {
  return { ...(await liveRenameRefs()), over };
}

/**
 * Rewrite one collection's live docs: `rewrite` returns the whole next doc or
 * null. Only docs it would change are written, each with patchDoc re-running
 * `rewrite` on the doc it re-reads. patchDoc always writes (and bumps `rev` /
 * `updatedAt`), so a doc the listing flagged is re-read first and skipped when
 * an edit since then already left nothing to rewrite (or deleted it).
 */
async function sweepCollection(coll: CollectionName, rewrite: (doc: Rec) => Rec | null, ctx: Ctx): Promise<StepOut> {
  let changed = 0;
  for (const doc of await listDocs<Doc>(coll)) {
    if (!rewrite(doc)) continue;
    if (ctx.over()) return { done: false, changed };
    const fresh = await getDoc<Doc>(coll, doc.id);
    if (!fresh || !rewrite(fresh)) continue;
    let wrote = false;
    await patchDoc<Doc>(coll, doc.id, (fresh) => {
      const next = rewrite(fresh);
      if (!next) return;
      wrote = true;
      return next as Doc;
    });
    if (wrote) changed++;
  }
  return { done: true, changed };
}

/** A rewriter over one top-level field of a doc, lifted to the whole doc. */
const onField =
  (key: string, rw: (v: unknown) => unknown | null) =>
  (doc: Rec): Rec | null => {
    const next = rw(doc[key]);
    return next === null ? null : { ...doc, [key]: next };
  };

/** Re-key link rows under their renamed SKUs: insert the copies only where the
 *  new id is free (a live row is already right; a soft-deleted one was
 *  detached by a person and stays detached), then retire the old rows. */
async function rekeyLinks<T extends Doc>(coll: CollectionName, moves: Array<{ old: T; copy: T | null }>, ctx: Ctx): Promise<StepOut> {
  let changed = 0;
  for (let i = 0; i < moves.length; i += LINK_CHUNK) {
    if (ctx.over()) return { done: false, changed };
    const chunk = moves.slice(i, i + LINK_CHUNK);
    const copies = chunk.map((x) => x.copy).filter((c): c is T => !!c);
    if (copies.length) await insertDocsIfAbsent<T>(coll, copies);
    await softDeleteDocs(coll, chunk.map((x) => x.old.id));
    changed += chunk.length;
  }
  return { done: true, changed };
}

async function docLinksStep(ctx: Ctx): Promise<StepOut> {
  const moves = (await allDocumentLinks())
    .filter((l) => ctx.m.has(l.partSku))
    .map((l) => {
      const partSku = ctx.m.get(l.partSku)!;
      const copy: PartDocumentLink = { ...l, id: documentLinkId(partSku, l.documentId), partSku };
      return { old: l, copy };
    });
  return rekeyLinks<PartDocumentLink>("part_document_links", moves, ctx);
}

async function accessoryLinksStep(ctx: Ctx): Promise<StepOut> {
  const moves = (await allAccessoryLinks())
    .filter((l) => ctx.m.has(l.parentSku) || ctx.m.has(l.accessorySku))
    .map((l) => {
      const parentSku = ctx.m.get(l.parentSku) ?? l.parentSku;
      const accessorySku = ctx.m.get(l.accessorySku) ?? l.accessorySku;
      // A part can't be its own accessory: such a link is just retired.
      if (parentSku === accessorySku) return { old: l, copy: null };
      // The id hashes the SCOPE the writer synced (an assembly's sourceRef,
      // or "" for the DaVinci scope whose rows carry a per-pair sourceRef) —
      // take whichever reproduces the row's own id, so a later re-sync of
      // that scope lands on the same row.
      const scopeRef = [l.sourceRef ?? "", ""].find((r) => accessoryLinkId(l.source, r, l.parentSku, l.accessorySku) === l.id) ?? l.sourceRef ?? "";
      const copy: PartAccessoryLink = { ...l, id: accessoryLinkId(l.source, scopeRef, parentSku, accessorySku), parentSku, accessorySku };
      return { old: l, copy };
    });
  return rekeyLinks<PartAccessoryLink>("part_accessory_links", moves, ctx);
}

/** Quotes' live `spec` (Estimator sections and Grid `lines`). A rewrite
 *  changes what the customer document prints, and this is a bulk writer with
 *  no request to render in: per the quote-pdf/schedule.ts contract (as the
 *  CSV import does) an existing PDF is marked stale as of that change. */
async function quotesStep(ctx: Ctx): Promise<StepOut> {
  const rw = (spec: unknown) => RW.rewriteQuoteSpec(spec, ctx.m, ctx.models);
  let changed = 0;
  for (const q of await listDocs<Doc>("quotes")) {
    if (!rw(q.spec)) continue;
    if (ctx.over()) return { done: false, changed };
    const written = await rewriteQuoteSpecRefs(q.id, rw);
    if (!written) continue;
    changed++;
    if (written.contentChangedAt) await markQuotePdfStale(written.id, written.contentChangedAt);
  }
  return { done: true, changed };
}

/**
 * Grid library symbols. A symbol seeded from a catalog part has id =
 * pricingPartId = modelNumber = the SKU (grid-catalog.ts fromPricing): it MOVES
 * to the new id (placements' partId follow in the grid-projects step through
 * the same map), keeping its look; the old id is retired. Then every symbol's
 * `pricingPartId` and assembly `members[].symbolId` are rewritten in place.
 */
async function gridSymbolsStep(ctx: Ctx): Promise<StepOut> {
  let changed = 0;
  for (const sym of await listDocs<Doc>("grid_catalog")) {
    const to = ctx.m.get(sym.id);
    if (!to) continue;
    if (ctx.over()) return { done: false, changed };
    const target = (await getDocRows<Doc>("grid_catalog", [to]))[0];
    // A live symbol already at the new id (Auto fill made one since) wins; the old one just retires.
    if (!target || target.deleted) {
      const pricing = typeof sym.pricingPartId === "string" ? sym.pricingPartId : null;
      const seededModel = !sym.modelNumber || sym.modelNumber === sym.id || sym.modelNumber === pricing;
      const moved: Doc = {
        ...sym,
        id: to,
        ...(pricing ? { pricingPartId: ctx.m.get(pricing) ?? pricing } : {}),
        modelNumber: seededModel ? (ctx.models.get(to) ?? sym.modelNumber) : sym.modelNumber,
        updatedAt: Date.now(),
      };
      await upsertDoc<Doc>("grid_catalog", (RW.rewriteGridSymbolMembers(moved, ctx.m) ?? moved) as Doc);
    }
    await softDeleteDoc("grid_catalog", sym.id);
    changed++;
  }
  const rest = await sweepCollection("grid_catalog", (d) => RW.rewriteGridSymbolMembers(d, ctx.m), ctx);
  return { done: rest.done, changed: changed + rest.changed };
}

/** Write back only the top-level keys `rewrite` changed (setBlob merges per
 *  top-level key, so a concurrent per-key save to another row survives). */
async function sweepBlob(id: string, rewrite: (raw: Rec) => Rec | null): Promise<number> {
  const raw = await getBlob<Rec>(id, {});
  const next = rewrite(raw);
  if (!next) return 0;
  const patch: Rec = {};
  for (const [k, v] of Object.entries(next)) if (v !== raw[k]) patch[k] = v;
  if (!Object.keys(patch).length) return 0;
  await setBlob(id, patch);
  return 1;
}

async function blobsStep(ctx: Ctx): Promise<StepOut> {
  const { m } = ctx;
  const idList = (raw: Rec) => RW.rewriteIdList(raw, m);
  const jobs: Array<[string, (raw: Rec) => Rec | null]> = [
    [EQUIPMENT_MAP_BLOB, (raw) => RW.rewriteEquipmentMap(raw, m)],
    [TRACK_SERIES_BLOB, (raw) => RW.rewriteTrackSeries(raw, m)],
    // One top-level key per mount type id, each `{ rows }`.
    [
      CURTAIN_MOUNTS_BLOB,
      (raw) => {
        let out: Rec | null = null;
        for (const [k, v] of Object.entries(raw)) {
          const hw = isRec(v) ? RW.rewriteCurtainMounts(v, m) : null;
          if (hw) (out ??= { ...raw })[k] = hw;
        }
        return out;
      },
    ],
    // `{ defaults: { blankSku, ventSku } }`.
    [
      RACK_DEFAULTS_BLOB,
      (raw) => {
        const d = isRec(raw.defaults) ? RW.rewriteRackDefaults(raw.defaults, m) : null;
        return d ? { ...raw, defaults: d } : null;
      },
    ],
    [DRIVE_PHOTO_SYNC_BLOB, (raw) => RW.rewriteDrivePhotoSync(raw, m)],
  ];
  const [favs, recents] = await Promise.all([listBlobIds(favoritesBlobId("")), listBlobIds(recentBlobId(""))]);
  for (const id of [...favs, ...recents]) jobs.push([id, idList]);
  let changed = 0;
  for (const [id, rw] of jobs) {
    if (ctx.over()) return { done: false, changed };
    changed += await sweepBlob(id, rw);
  }
  if (ctx.over()) return { done: false, changed };
  // settings.wireTypes: only a stored list (the defaults are code). Read
  // strictly — a failed read must not look like "no wire types".
  const wireTypes = RW.rewriteWireTypes((await getSettingsPatchStrict()).wireTypes, m);
  if (wireTypes) {
    await setSettings({ wireTypes });
    changed++;
  }
  return { done: true, changed };
}

function refStep(step: RefStep, ctx: Ctx): Promise<StepOut> {
  const { m } = ctx;
  switch (step) {
    case "parts-refs":
      return sweepCollection("catalog_parts", (d) => RW.rewritePartRefs(d, m), ctx);
    case "doc-links":
      return docLinksStep(ctx);
    case "accessory-links":
      return accessoryLinksStep(ctx);
    case "quotes":
      return quotesStep(ctx);
    case "projects":
      return sweepCollection("projects", onField("procurement", (v) => RW.rewriteProcurement(v, m)), ctx);
    case "portal-carts":
      return sweepCollection("portal_carts", onField("lines", (v) => RW.rewriteCartLines(v, m)), ctx);
    case "spec-documents":
      return sweepCollection("spec_documents", onField("products", (v) => RW.rewriteSpecDocProducts(v, m)), ctx);
    case "subassemblies":
      return sweepCollection("subassemblies", (d) => RW.rewriteSubassembly(d, m), ctx);
    case "grid-symbols":
      return gridSymbolsStep(ctx);
    case "grid-projects":
      return sweepCollection("grid_projects", (d) => RW.rewriteGridProjectLive(d, m), ctx);
    case "blobs":
      return blobsStep(ctx);
  }
}

/** The parts step: re-plan, then rename in chunks with a log append per chunk. */
async function partsStep(rows: CrosswalkRow[], by: string, over: () => boolean): Promise<RenameBatchResult> {
  const ctx = await loadPlanContext();
  const plan = planRenames(rows, ctx.live, ctx.retired);
  // A rename whose log append was lost (the call died between the two)
  // plans as `already` from here on — log it now, or no reference step
  // would ever rewrite its old SKU.
  const logged = renameMapOf(await allSkuRenames());
  const relog: SkuRename[] = plan.rows
    .filter((r) => r.outcome === "already" && r.to && logged.get(r.from) !== r.to && r.from !== r.to)
    .map((r) => ({ from: r.from, to: r.to!, model: r.model, at: Date.now(), by }));
  await appendSkuRenames(relog);
  let renamed = 0;
  for (let i = 0; i < plan.renames.length; i += PARTS_CHUNK) {
    if (over()) return { ok: true, step: "parts", complete: false, renamed, changed: renamed, plan };
    const entries: SkuRename[] = [];
    for (const r of plan.renames.slice(i, i + PARTS_CHUNK)) {
      const part = await renamePartDocs(r.from, r.to, r.model);
      if (!part) continue; // taken since planning, or retired elsewhere — skipped
      entries.push({ from: r.from, to: part.sku, model: r.model, at: Date.now(), by });
      renamed++;
    }
    await appendSkuRenames(entries);
  }
  return { ok: true, step: REF_STEPS[0], complete: false, renamed, changed: renamed, plan };
}

const STEPS: ReadonlySet<string> = new Set<string>(["parts", ...REF_STEPS, "done"]);

/**
 * One batch of the rename: the step named by `input.step` (the parts step is
 * skipped when `refsOnly`), stopping between writes once `budgetMs` is spent.
 * The result's `step` is the one to call with next; `complete` is true only
 * on `done`. `revalidatePath` is the calling action's job.
 */
export async function runRenameBatch(input: RenameBatchInput, by: string, budgetMs: number): Promise<RenameBatchResult> {
  const start = Date.now();
  const over = () => Date.now() - start > budgetMs;
  try {
    const rows = cleanRows(input?.rows);
    if (!rows) return { ok: false, error: `The sheet must be a list of at most ${CROSSWALK_MAX_ROWS.toLocaleString()} rows.` };
    let step = input?.step;
    if (typeof step !== "string" || !STEPS.has(step)) return { ok: false, error: "Unknown rename step." };
    if (step === "done") return { ok: true, step: "done", complete: true, renamed: 0, changed: 0, plan: null };
    if (step === "parts" && input.refsOnly) step = REF_STEPS[0];
    if (step === "parts") return await partsStep(rows, String(by || "").trim() || "system", over);
    const out = await refStep(step, await refContext(over));
    if (!out.done) return { ok: true, step, complete: false, renamed: 0, changed: out.changed, plan: null };
    const next = REF_STEPS[REF_STEPS.indexOf(step) + 1] as RefStep | undefined;
    return { ok: true, step: next ?? "done", complete: !next, renamed: 0, changed: out.changed, plan: null };
  } catch (err) {
    console.error("[catalog-rename] batch failed", input?.step, err);
    return { ok: false, error: "The rename stopped on an error — run it again to resume." };
  }
}

import type { DriveListedPhoto } from "@/lib/google/drive-photos";
import { HEIC_REASON, OVER_CAP_REASON } from "./drive-photo-plan";
import { droppedNameOf, driveIdOf, PHOTO_SLOTS, slotSource, type ImportRow, type PartMatcher, type SheetImage } from "./photo-sheet";
import { MAX_PART_IMAGE_BYTES } from "./types";

/**
 * Catalog photo sheet — what one import should do, decided purely. Per
 * filled Photo cell, first rule wins: row unmatched/ambiguous → one row
 * problem; equal to what the part's slot already shows → skip; an http(s)
 * URL; another scheme → problem; else a file name (dropped file first, then
 * the Drive listing exact, then case-insensitive, duplicates refused);
 * already attached by URL / Drive id / dropped name → skip; else add. Adds
 * naming the same URL, Drive file or dropped name collapse into one planned
 * document linked to every part. Safe in client components.
 */

export type DroppedFile = { name: string; size: number };
export type PlannedLink = { sku: string; primary: boolean; rowNumber: number; slot: number };
export type PlannedDoc =
  | { key: string; via: "url"; url: string; existingId: string | null; links: PlannedLink[] }
  | { key: string; via: "drive"; file: DriveListedPhoto; existingId: string | null; links: PlannedLink[] }
  | { key: string; via: "dropped"; name: string; links: PlannedLink[] };
export type PlanProblem = { rowNumber: number; slot: number | null; value: string; reason: string };
export type PlanSkip = { rowNumber: number; slot: number; sku: string };
export type PhotoSheetPlan = { docs: PlannedDoc[]; skipped: PlanSkip[]; problems: PlanProblem[]; matched: number };
export type PlanInput = {
  rows: readonly ImportRow[];
  match: PartMatcher;
  /** Each part's REAL images (no datasheet-render), gallery order. */
  imagesBySku: ReadonlyMap<string, readonly SheetImage[]>;
  /** Any image document's sourceUrl → its id (shared docs get linked, not re-fetched). */
  imageByUrl: ReadonlyMap<string, string>;
  /** Any image document's Drive file id → its id. */
  imageByDriveId: ReadonlyMap<string, string>;
  dropped: readonly DroppedFile[];
  /** The Peak Product Photos listing; null when it can't be read. */
  drive: readonly DriveListedPhoto[] | null;
  /** Why `drive` is null, e.g. "Drive photos aren't connected". */
  driveReason: string;
  /** Each part's images a person detached (soft-deleted links, live documents):
   *  a cell naming one is a problem — a detach is never undone by a re-run. */
  removedBySku?: ReadonlyMap<string, readonly SheetImage[]>;
};
export type SheetDocOutcome = { key: string; ok: boolean; error?: string; documentId?: string };

export const REMOVED_REASON = "removed from this part earlier — re-add it in the part editor";
export const NEEDS_KEY_REASON = "fill in Manufacturer or SKU";

const HEIC_NAME = /\.(heic|heif)$/i;
const HEIC_MIME = new Set(["image/heic", "image/heif"]);
const HTTP = /^https?:\/\//i;
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function planPhotoSheet(input: PlanInput): PhotoSheetPlan {
  const plan: PhotoSheetPlan = { docs: [], skipped: [], problems: [], matched: 0 };
  const byKey = new Map<string, PlannedDoc>();
  const droppedByName = new Map(input.dropped.map((f) => [f.name.toLowerCase(), f] as const));
  const driveNames = new Map((input.drive ?? []).map((f) => [f.id, f.name] as const));

  const addLink = (key: string, make: () => PlannedDoc, link: PlannedLink) => {
    let doc = byKey.get(key);
    if (!doc) {
      doc = make();
      byKey.set(key, doc);
      plan.docs.push(doc);
    }
    const same = doc.links.find((l) => l.sku === link.sku);
    if (!same) return void doc.links.push(link);
    // The same photo named twice for one part: one link; the repeat cell is a skip.
    same.primary ||= link.primary;
    plan.skipped.push({ rowNumber: link.rowNumber, slot: link.slot, sku: link.sku });
  };

  for (const row of input.rows) {
    const values = row.photos.slice(0, PHOTO_SLOTS).map((v) => String(v ?? "").trim());
    if (!values.some(Boolean)) continue;
    const m = input.match(row);
    if (m.kind !== "matched") {
      const reason =
        m.kind === "ambiguous"
          ? `ambiguous — fill the SKU column (${m.skus.slice(0, 5).join(", ")}${m.skus.length > 5 ? ", …" : ""})`
          : m.kind === "needs-key"
            ? NEEDS_KEY_REASON
            : "no matching part";
      plan.problems.push({ rowNumber: row.rowNumber, slot: null, value: "", reason });
      continue;
    }
    plan.matched++;
    const sku = m.sku;
    const imgs = input.imagesBySku.get(sku) ?? [];
    const shown = sourceSet(imgs.map((i) => slotSource(i, driveNames)));
    const removed = input.removedBySku?.get(sku) ?? [];
    const removedShown = sourceSet(removed.map((i) => slotSource(i, driveNames)));
    const removedUrls = new Set(removed.map((i) => i.sourceUrl).filter((u): u is string => !!u));
    const removedDrive = new Set(removed.map(driveIdOf).filter((d): d is string => !!d));
    const removedDropped = new Set(removed.map((i) => droppedNameOf(i)?.toLowerCase()).filter((n): n is string => !!n));

    values.forEach((v, i) => {
      if (!v) return;
      const slot = i + 1;
      const link: PlannedLink = { sku, primary: slot === 1, rowNumber: row.rowNumber, slot };
      const problem = (reason: string) => plan.problems.push({ rowNumber: row.rowNumber, slot, value: v, reason });
      const skip = () => plan.skipped.push({ rowNumber: row.rowNumber, slot, sku });
      if (shown(v)) return skip();
      if (removedShown(v)) return problem(REMOVED_REASON);

      if (HTTP.test(v)) {
        if (imgs.some((img) => img.sourceUrl === v)) return skip();
        if (removedUrls.has(v)) return problem(REMOVED_REASON);
        return addLink(`url:${v}`, () => ({ key: `url:${v}`, via: "url", url: v, existingId: input.imageByUrl.get(v) ?? null, links: [] }), link);
      }
      if (OTHER_SCHEME.test(v)) return problem("not an http(s) URL");

      const name = v.split(/[\\/]/).pop() || v;
      if (HEIC_NAME.test(name)) return problem(HEIC_REASON);
      const dropped = droppedByName.get(name.toLowerCase());
      if (dropped) {
        if (dropped.size > MAX_PART_IMAGE_BYTES) return problem(OVER_CAP_REASON);
        if (imgs.some((img) => droppedNameOf(img)?.toLowerCase() === dropped.name.toLowerCase())) return skip();
        if (removedDropped.has(dropped.name.toLowerCase())) return problem(REMOVED_REASON);
        const key = `file:${dropped.name.toLowerCase()}`;
        return addLink(key, () => ({ key, via: "dropped", name: dropped.name, links: [] }), link);
      }
      if (!input.drive) return problem(`not dropped, and ${input.driveReason}`);
      let hits = input.drive.filter((f) => f.name === name);
      if (!hits.length) hits = input.drive.filter((f) => f.name.toLowerCase() === name.toLowerCase());
      if (hits.length > 1) return problem(`${hits.length} Drive files share this name`);
      const file = hits[0];
      if (!file) return problem("not dropped and not in Peak Product Photos");
      if (HEIC_MIME.has(file.mimeType)) return problem(HEIC_REASON);
      if (file.size > MAX_PART_IMAGE_BYTES) return problem(OVER_CAP_REASON);
      if (imgs.some((img) => driveIdOf(img) === file.id)) return skip();
      if (removedDrive.has(file.id)) return problem(REMOVED_REASON);
      const key = `drive:${file.id}`;
      return addLink(key, () => ({ key, via: "drive", file, existingId: input.imageByDriveId.get(file.id) ?? null, links: [] }), link);
    });
  }
  return plan;
}

/** "Is this cell one of these slot sources?" — http(s) values compare
 *  exactly (a URL's path is case-sensitive), file names in any case. */
function sourceSet(sources: readonly string[]): (v: string) => boolean {
  const exact = new Set(sources);
  const names = new Set(sources.filter((s) => !HTTP.test(s)).map((s) => s.toLowerCase()));
  return (v) => (HTTP.test(v) ? exact.has(v) : names.has(v.toLowerCase()));
}

/** The failed keys worth sending with one chunk: only docs this chunk's rows plan. */
export function failedKeysForChunk(plan: PhotoSheetPlan, rowNumbers: Iterable<number>, failedKeys: readonly string[]): string[] {
  const rows = new Set(rowNumbers);
  const keys = new Set(plan.docs.filter((d) => d.links.some((l) => rows.has(l.rowNumber))).map((d) => d.key));
  return [...new Set(failedKeys)].filter((k) => keys.has(k));
}

export function planCounts(plan: PhotoSheetPlan): { add: number; skip: number; problems: number } {
  return { add: plan.docs.reduce((n, d) => n + d.links.length, 0), skip: plan.skipped.length, problems: plan.problems.length };
}

/** One outcome per key: a not-ok outcome wins over an ok one (worst wins), otherwise the first is kept. Order follows first appearance. */
export function mergeOutcomes(outcomes: readonly SheetDocOutcome[]): SheetDocOutcome[] {
  const byKey = new Map<string, SheetDocOutcome>();
  for (const o of outcomes) {
    const prev = byKey.get(o.key);
    if (!prev || (prev.ok && !o.ok)) byKey.set(o.key, o);
  }
  return [...byKey.values()];
}

/** Photo links (doc × part) that landed vs. didn't — a doc with no outcome counts as not imported. */
export function linkTotals(plan: PhotoSheetPlan, outcomes: readonly SheetDocOutcome[]): { added: number; failed: number } {
  const byKey = new Map(outcomes.map((o) => [o.key, o] as const));
  let added = 0;
  let failed = 0;
  for (const d of plan.docs) {
    if (byKey.get(d.key)?.ok) added += d.links.length;
    else failed += d.links.length;
  }
  return { added, failed };
}

/** Status column text per row for the results sheet: problems and failures
 *  by slot (a row problem first), then "Added N", then "Skipped N (already attached)". */
export function resultStatuses(plan: PhotoSheetPlan, outcomes: readonly SheetDocOutcome[]): Map<number, string> {
  const byKey = new Map(outcomes.map((o) => [o.key, o] as const));
  const acc = new Map<number, { added: number; skipped: number; notes: Array<{ slot: number; text: string }> }>();
  const at = (n: number) => {
    let a = acc.get(n);
    if (!a) acc.set(n, (a = { added: 0, skipped: 0, notes: [] }));
    return a;
  };
  for (const p of plan.problems) at(p.rowNumber).notes.push({ slot: p.slot ?? 0, text: p.slot ? `Photo ${p.slot}: ${p.reason}` : p.reason });
  for (const s of plan.skipped) at(s.rowNumber).skipped++;
  for (const d of plan.docs) {
    const o = byKey.get(d.key);
    for (const l of d.links) {
      if (o?.ok) {
        at(l.rowNumber).added++;
        // A placement warning on an otherwise-landed photo still shows in Status.
        if (o.error) at(l.rowNumber).notes.push({ slot: l.slot, text: `Photo ${l.slot}: ${o.error}` });
      } else at(l.rowNumber).notes.push({ slot: l.slot, text: `Photo ${l.slot}: ${o ? o.error || "failed" : "not imported"}` });
    }
  }
  const out = new Map<number, string>();
  for (const [row, a] of acc) {
    const parts = a.notes.sort((x, y) => x.slot - y.slot).map((n) => n.text);
    if (a.added) parts.push(`Added ${a.added}`);
    if (a.skipped) parts.push(`Skipped ${a.skipped} (already attached)`);
    out.set(row, parts.join("; "));
  }
  return out;
}

import { mfrKey } from "@/lib/catalog-books";
import { peakMfrFor } from "@/lib/catalog-davinci-apply";
import { buildIndexWithStats, matchSku } from "./match";
import type { DavinciExtract, DavinciImageMeta } from "./types";

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
  /** The DaVinci type's name — the title when the image has no name of its own. */
  displayName: string;
  /** The image's own name in library.json (`imageMetadata.imageName`), when it has one. */
  imageName?: string;
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
  /** This exact DaVinci drawing was detached from the part earlier — never re-attached. */
  | "removed";

/** How the dry run / summary names each skip reason. */
export const SKIP_REASON_LABEL: Record<SymbolSkipReason, string> = {
  "not-downloaded": "not downloaded",
  "already-present": "already present",
  "hand-uploaded": "hand-uploaded",
  removed: "detached earlier",
};

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
 * DaVinci's "Unknown" image (`VISUAL_UNKNOWN`: imageName "Unknown", imageType
 * "Other") — the plan image of 705 records in the 2026-04-21 library. A
 * placeholder, not a drawing: never attached to a part.
 */
export const VISUAL_UNKNOWN_IMAGE_ID = "fcc23ef1-eff9-413e-b6a8-820a88a70e9f";

/**
 * Is this image a DaVinci placeholder rather than a product drawing? The
 * VISUAL_UNKNOWN id, anything typed "Other", or anything named "Unknown".
 * Deliberately NOT any other imageType: real drawings are mis-tagged
 * "Template Preview" / "Title Block" in the library.
 */
export function isPlaceholderImage(imageId: string, meta?: Partial<DavinciImageMeta>): boolean {
  if (imageId === VISUAL_UNKNOWN_IMAGE_ID) return true;
  if ((meta?.type ?? "").trim() === "Other") return true;
  return /^unknown$/i.test((meta?.name ?? "").trim());
}

/**
 * One candidate per (part, kind) whose matched DaVinci type carries an image
 * id that is a real drawing (placeholders are skipped and counted in
 * `stats.placeholder`). `catalog` is every catalog row; the manufacturer gate
 * scopes it.
 */
export function candidatesFor(
  extract: DavinciExtract,
  catalog: ReadonlyArray<{ id: string; sku: string; manufacturer?: string }>,
  stats?: { placeholder: number }
): SymbolImportCandidate[] {
  const { index } = buildIndexWithStats(extract.records);
  const images = extract.images ?? {};
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
      const meta = Object.prototype.hasOwnProperty.call(images, imageId) ? images[imageId] : undefined;
      if (isPlaceholderImage(imageId, meta)) {
        if (stats) stats.placeholder++;
        continue;
      }
      out.push({
        partSku: p.sku,
        kind,
        imageId,
        typeId: rec.typeId,
        displayName: rec.displayName,
        ...(meta?.name ? { imageName: meta.name } : {}),
      });
    }
  }
  return out;
}

/**
 * Image ids that more than `threshold` distinct matched parts would share —
 * printed before any write so a placeholder the filter above doesn't know
 * yet is visible before `--apply`. Most-shared first.
 */
export function sharedImages(
  candidates: readonly SymbolImportCandidate[],
  threshold = 25
): Array<{ imageId: string; parts: number; name: string }> {
  const parts = new Map<string, Set<string>>();
  const names = new Map<string, string>();
  for (const c of candidates) {
    const set = parts.get(c.imageId) ?? new Set<string>();
    set.add(c.partSku);
    parts.set(c.imageId, set);
    if (!names.has(c.imageId)) names.set(c.imageId, c.imageName || c.displayName);
  }
  return [...parts]
    .filter(([, set]) => set.size > threshold)
    .map(([imageId, set]) => ({ imageId, parts: set.size, name: names.get(imageId) ?? "" }))
    .sort((a, b) => b.parts - a.parts || a.imageId.localeCompare(b.imageId));
}

/**
 * `--apply` safety (#300 fix round 1). Returns the refusal message, or null
 * when the write may go ahead. Checked before anything is read or planned.
 *  - a hosted DB always needs --yes;
 *  - a Blob token means real uploads into a shared store: --yes, always;
 *  - a LOCAL DB with a Blob token would leave the uploaded files orphaned in
 *    that shared store (no hosted record points at them) — refused unless
 *    --local-blob says that is intended.
 * No Blob token is allowed through: the script then writes nothing.
 */
export function applyRefusal(o: { hosted: boolean; blob: boolean; yes: boolean; localBlob: boolean; store: string; db: string }): string | null {
  if (o.hosted && !o.yes) {
    return `Refusing to write to the HOSTED database (${o.db}) without --yes.\nTake a backup first (DATABASE_URL=... npm run db:export), then re-run with --yes.`;
  }
  if (o.blob && !o.yes) {
    return `--apply uploads drawings to Blob ${o.store} and writes ${o.db}.\nRe-run with --yes to confirm.`;
  }
  if (o.blob && !o.hosted && !o.localBlob) {
    return (
      `Refusing a LOCAL-database apply (${o.db}) with a Blob token (${o.store}).\n` +
      `The drawings would upload into that shared store while only this local database points at them —\n` +
      `orphaned files nobody can see or clean up. Run against the hosted DATABASE_URL, unset BLOB_READ_WRITE_TOKEN,\n` +
      `or pass --local-blob if orphaned blobs are really intended.`
    );
  }
  return null;
}

/**
 * Which Blob store a token writes to, without ever printing the token:
 * BLOB_STORE_ID when set, else the store id segment of a
 * `vercel_blob_rw_<storeId>_<secret>` token, else "unknown".
 */
export function blobStoreLabel(env: { BLOB_STORE_ID?: string; BLOB_READ_WRITE_TOKEN?: string }): string {
  const explicit = (env.BLOB_STORE_ID ?? "").trim();
  if (explicit) return explicit;
  const m = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(env.BLOB_READ_WRITE_TOKEN ?? "");
  return m ? `store_${m[1]}` : "unknown";
}

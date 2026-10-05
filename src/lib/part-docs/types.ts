/**
 * Part documents (#207) — the shared shapes. Pure: no store, no `@/db`, no
 * Node built-ins, so client components import this freely.
 *
 * A document is a SHARED record (DaVinci's model): one datasheet PDF is
 * linked to many parts through `part_document_links`, and accessories are
 * covered by their fixture's document through `part_accessory_links` —
 * computed in context (src/lib/part-docs/coverage.ts), never stored on the
 * accessory. Spec: docs/superpowers/specs/2026-09-25-part-documents-design.md §5.
 */

export type PartDocKind = "datasheet" | "specsheet" | "manual" | "image" | "symbol" | "riser";

/** The object-drawing kinds (#300, D606): a part's plan `symbol` and its
 *  front-view `riser` drawing. Like `image`, neither is a coverage slot —
 *  they never appear on the Datasheets to-do list, in coverage, the portal,
 *  client packages or the Displays API. One current link per part per kind
 *  (attachDocument unlinks the previous one). SVG (sanitized on the way in)
 *  or a raster shrunk to ≤ 1024 px WebP. */
export const DRAWING_KINDS = ["symbol", "riser"] as const;
export type DrawingKind = (typeof DRAWING_KINDS)[number];
export function isDrawingKind(v: unknown): v is DrawingKind {
  return (DRAWING_KINDS as readonly unknown[]).includes(v);
}

/** The coverage slots — a datasheet/spec-sheet/manual document can satisfy
 *  a part's requirement; an image never can (#245). Existing screens iterate
 *  this (not ALL_PART_DOC_KINDS) so they show exactly these columns. #290
 *  added `manual` (PDF only). */
export const DOC_SLOT_KINDS = ["datasheet", "specsheet", "manual"] as const;

/** The narrow slot type every coverage-slot function is keyed by — distinct
 *  from the wider `PartDocKind` so a `Record`/switch keyed by it stays
 *  exhaustive without "image" (#245). */
export type DocSlotKind = (typeof DOC_SLOT_KINDS)[number];

/** Every part-document kind, coverage slots plus the gallery-only `image`
 *  kind (#245) and the object-drawing kinds (#300). */
export const ALL_PART_DOC_KINDS = ["datasheet", "specsheet", "manual", "image", "symbol", "riser"] as const;

/** Alias of DOC_SLOT_KINDS — typed to the narrow DocSlotKind (not the wider
 *  PartDocKind) so iterating it never introduces "image" into a slot-keyed
 *  Record or a DocumentRow index. */
export const PART_DOC_KINDS: readonly DocSlotKind[] = DOC_SLOT_KINDS;
export const PART_DOC_KIND_LABEL: Record<PartDocKind, string> = {
  datasheet: "Datasheet",
  specsheet: "Spec sheet",
  manual: "Manual",
  image: "Image",
  symbol: "Symbol drawing",
  riser: "Riser drawing",
};

export function isPartDocKind(v: unknown): v is PartDocKind {
  return isDocSlotKind(v) || v === "image" || isDrawingKind(v);
}

/** Narrower than isPartDocKind (#245 review fix): true only for the
 *  coverage-slot kinds. `fetchLinksAction` and `setNotNeededAction` are both
 *  slot-only operations — an image kind slipping past a check built on the
 *  wider isPartDocKind would let a client ask to "fetch" or "mark not
 *  needed" an image, neither of which the image slot supports. */
export function isDocSlotKind(v: unknown): v is DocSlotKind {
  return (DOC_SLOT_KINDS as readonly unknown[]).includes(v);
}

/** `drive` (#283) — an image imported from the Peak Product Photos Drive folder. */
export type PartDocumentSource = "upload" | "drive" | "fetch" | "davinci" | "legacy" | "datasheet-render" | "sheet" | "manufacturer";

/** A file this document used to hold. Replacing never deletes the blob (§2.4). */
export type PartDocumentHistoryEntry = {
  blobKey: string;
  fileName: string;
  size: number;
  replacedAt: number;
  replacedBy: string;
  /** What the SVG sanitizer stripped from this file (#300) — carried over from the document when it was replaced. */
  svgRemoved?: string[];
};

export type PartDocument = {
  id: string;
  kind: PartDocKind;
  title: string;
  fileName: string;
  contentType: string;
  size: number;
  /** Private Vercel Blob pathname (`part-docs/<id>/<file>`); null = link only. */
  blobKey: string | null;
  /** The manufacturer URL this document came from (or can be fetched from). */
  sourceUrl: string | null;
  source: PartDocumentSource;
  /** DaVinci documentId, legacy SKU, … — provenance only. */
  sourceRef?: string;
  language?: string;
  uploadedAt: number;
  uploadedBy: string;
  history: PartDocumentHistoryEntry[];
  /** The last fetch attempt of `sourceUrl` (D272): failures stay listed
   *  with their reason until a later fetch succeeds. */
  lastFetch?: { at: number; ok: boolean; error?: string };
  /** What `sanitizeSvg` stripped from the current file (#300, symbol/riser
   *  SVG only) — e.g. "script elements", "event handlers" — so an admin can
   *  see what a drawing lost on the way in. Absent = nothing stripped. */
  svgRemoved?: string[];
};

export type PartDocumentLink = {
  id: string;
  partSku: string;
  documentId: string;
  kind: PartDocKind;
  createdAt: number;
  createdBy: string;
  /** Gallery order for an image link (#245) — missing sorts last. */
  sort?: number;
  /** Hide an image from the gallery without detaching it (#245). */
  hidden?: boolean;
};

export type AccessoryLinkSource = "assembly" | "davinci" | "manual";

export type PartAccessoryLink = {
  id: string;
  parentSku: string;
  accessorySku: string;
  maxQty?: number;
  included?: boolean;
  /** The accessory ships its own datasheet — this parent link never covers it (§4). */
  ownDatasheet?: boolean;
  source: AccessoryLinkSource;
  sourceRef?: string;
};

/** One parent → accessory pair a writer wants in the graph. */
export type AccessoryPair = {
  parentSku: string;
  accessorySku: string;
  maxQty?: number;
  included?: boolean;
  /** Provenance for this one pair (a DaVinci parent typeId). */
  sourceRef?: string;
};

/** Per-kind "this part needs no document" marks, stored on the catalog part. */
export type DocNotNeeded = { datasheet?: true; specsheet?: true; manual?: true };

/** Upload and fetch ceiling (§6). */
export const MAX_PART_DOC_BYTES = 25 * 1024 * 1024;

/** Image cap (#245; #283 raised 10 → 25 MB — images are shrunk on the way in, so this only bounds what's read into memory). */
export const MAX_PART_IMAGE_BYTES = 25 * 1024 * 1024;

/** Object-drawing cap (#300): a symbol/riser raster is shrunk to ≤ 1024 px
 *  and an SVG must sanitize under 1 MB (SVG_MAX_BYTES), so 5 MB is plenty. */
export const MAX_PART_DRAWING_BYTES = 5 * 1024 * 1024;

/** The byte ceiling for a slot's kind (#245). */
export function maxBytesFor(kind: PartDocKind): number {
  if (isDrawingKind(kind)) return MAX_PART_DRAWING_BYTES;
  return kind === "image" ? MAX_PART_IMAGE_BYTES : MAX_PART_DOC_BYTES;
}

/** Gallery ordering rank for an image link (#245) — lower sorts first,
 *  used only as `compareImages`'s tertiary tiebreak (below). */
export const IMAGE_SOURCE_RANK: Record<PartDocumentSource, number> = {
  upload: 0,
  drive: 0,
  sheet: 0,
  manufacturer: 0,
  fetch: 1,
  davinci: 2,
  "datasheet-render": 3,
  legacy: 4,
};

/** The one shared, pure gallery-order comparator (#245 review fix — the
 *  original rank-first rule silently made ↑/↓ a no-op across sources, since
 *  a `sort` write could never outrank a lower-ranked source). Order:
 *   1. an auto-generated datasheet-render thumbnail always sorts after
 *      every real image, regardless of its own `sort`;
 *   2. then explicit `sort` ascending (missing sorts last, +∞);
 *   3. then IMAGE_SOURCE_RANK (upload/drive, fetch, davinci, legacy);
 *   4. then upload time.
 *  Shared by the store's customer-facing read (`visibleImagesForParts`) and
 *  the staff view builder (`src/lib/part-docs/views.ts`) so both order a
 *  part's images identically — no duplicated ordering logic. */
export function compareImages(
  a: { source: PartDocumentSource; sort: number | null | undefined; uploadedAt: number },
  b: { source: PartDocumentSource; sort: number | null | undefined; uploadedAt: number }
): number {
  const autoA = a.source === "datasheet-render" ? 1 : 0;
  const autoB = b.source === "datasheet-render" ? 1 : 0;
  if (autoA !== autoB) return autoA - autoB;
  const sortA = a.sort ?? Infinity;
  const sortB = b.sort ?? Infinity;
  if (sortA !== sortB) return sortA - sortB;
  const rank = IMAGE_SOURCE_RANK[a.source] - IMAGE_SOURCE_RANK[b.source];
  if (rank) return rank;
  return a.uploadedAt - b.uploadedAt;
}

/** Slots fetched per server-action call — each can take up to the fetcher's
 *  30 s timeout, so the page loops over a selection in batches this size. */
export const FETCH_BATCH_SIZE = 4;

/** Ceiling on a single fetch attempt's own timeout (review fix wave 1, I1) —
 *  also doubles as "one fetch's worst case" for the batch deadline check in
 *  src/lib/part-docs/fetch-links.ts (mirrors src/lib/geo-backfill.ts's
 *  worstCasePerQuery pattern: the check uses the ceiling, not whatever time
 *  happens to be left, so it can never let a call overrun by more than the
 *  time already spent). */
export const MAX_FETCH_TIMEOUT_MS = 30_000;

/** Wall-clock budget for one `fetchLinksAction` call (I1) — keeps the whole
 *  batch under Vercel's function limit with headroom for the request/
 *  response and revalidation, same margin as settings/actions.ts's
 *  geocodeBatchAction (budgetMs 45_000 under a 60s maxDuration). */
export const FETCH_ACTION_BUDGET_MS = 45_000;

/** Wall-clock budget for one `prefillFromDavinciAction` call (review fix
 *  wave 1) — the same 45 s under the page's 60 s maxDuration as the fetch
 *  action; planning (the catalog load) counts against it too. */
export const PREFILL_ACTION_BUDGET_MS = 45_000;

/** A pre-fill write chunk only starts while this much budget remains: one
 *  DOC_BATCH_CHUNK (500-row) multi-row statement over the network, with a
 *  generous margin — measured well under a second on a local database. */
export const PREFILL_CHUNK_WORST_CASE_MS = 5_000;

/** Blob pathname prefix — every part document lives under it. */
export const PART_DOC_PREFIX = "part-docs/";

/** `PD-` + 12 lowercase hex. Random, so minting one needs no collection scan
 *  and a browser can mint the id its upload path is keyed under. The legacy
 *  backfill uses its own deterministic `PD-L…` ids (see legacyDocumentId). */
export function newDocumentId(): string {
  return "PD-" + globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/** Every id this module mints: `PD-` + 6-40 letters/digits. Blocks path
 *  traversal in the upload route and the attach actions. */
export function isDocumentId(v: unknown): v is string {
  return typeof v === "string" && /^PD-[A-Za-z0-9]{6,40}$/.test(v);
}

/** Started as the same rule as src/lib/blob.ts `safeName` (which is
 *  server-only because it shares a module with the Blob SDK), duplicated
 *  here so the browser can build the exact pathname the upload route will
 *  accept — the two have since diverged: unlike `safeName`, this strips a
 *  leading `.` too (not just leading/trailing `_`), so the result always
 *  starts with a character the strict `SAFE_FILE_SEGMENT` rule allows —
 *  see `blobPathBelongsTo`. */
export function safeDocFileName(name: string): string {
  return (
    String(name ?? "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^[._]+|_+$/g, "")
      .slice(0, 80) || "file"
  );
}

/** `part-docs/<documentId>/<fileName>` (§5). The Blob SDK appends a random
 *  suffix, so a replace under the same document id never overwrites. */
export function partDocBlobPath(documentId: string, fileName: string): string {
  return `${PART_DOC_PREFIX}${documentId}/${safeDocFileName(fileName)}`;
}

/**
 * The file segment of a part-doc blob path, after the `part-docs/<id>/`
 * prefix: what `safeDocFileName` produces, plus whatever suffix Blob's
 * `addRandomSuffix` appends. A strict allow-list, not a blocklist — `get`
 * concatenates the pathname into a URL, and WHATWG URL parsing treats `\`
 * as `/` and percent-decodes `%2e%2e`/`%2f` before dot-segment removal on
 * some paths, so a blocklist of literal `..` and `/` can be bypassed by an
 * encoded or backslash-separated traversal segment (e.g.
 * `%2e%2e\PD-000000000000\x.pdf`). No `%`, `\`, `?`, `#`, or space can ever
 * appear in an accepted segment, and a leading `.` is refused so a bare
 * `.` or `..` (encoded or not) never matches either.
 */
const SAFE_FILE_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** Does `pathname` belong to `documentId`? Used on every client-supplied
 *  pathname before the server reads or records it — a client blobPath is
 *  untrusted input. */
export function blobPathBelongsTo(pathname: unknown, documentId: string): pathname is string {
  if (typeof pathname !== "string" || !isDocumentId(documentId)) return false;
  const prefix = `${PART_DOC_PREFIX}${documentId}/`;
  if (!pathname.startsWith(prefix)) return false;
  return SAFE_FILE_SEGMENT.test(pathname.slice(prefix.length));
}

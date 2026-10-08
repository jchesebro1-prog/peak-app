import type { ChipKind, PhotoAlign, PhotoAttrs, PDMarkType } from "./types";

/**
 * Estimator Phase 5 — the package document schema, as data. The sanitizer
 * (sanitize.ts), the renderer and the TipTap extensions all read these lists,
 * so the editor can never produce a node the server would drop (the harness
 * checks the editor's node/mark names against them). Client-safe.
 */

export const DOC_VERSION = 1 as const;

/** Top-level (and productBlock-free) block nodes. */
export const BLOCK_NODES = ["paragraph", "heading", "bulletList", "orderedList", "pageBreak", "priceTable", "productBlock"] as const;
export const INLINE_NODES = ["text", "hardBreak", "chip"] as const;
/** Every node name the schema knows (doc + blocks + listItem + inline). */
export const NODE_NAMES = ["doc", ...BLOCK_NODES, "listItem", ...INLINE_NODES] as const;
export const MARK_NAMES: readonly PDMarkType[] = ["bold", "italic"];
export const CHIP_KINDS: readonly ChipKind[] = ["systemPrice", "systemName", "lineQty", "quoteNumber", "grandTotal"];
/** Chip kinds whose ref names a system (sectionId). lineQty is `sectionId:lineKey`. */
export const SYSTEM_CHIP_KINDS: readonly ChipKind[] = ["systemPrice", "systemName"];
export const PHOTO_ALIGNS: readonly PhotoAlign[] = ["left", "right", "full"];
export const HEADING_LEVELS = [1, 2, 3] as const;

/** What a list item may hold (first child is always a paragraph). */
export const LIST_ITEM_CHILDREN = ["paragraph", "bulletList", "orderedList"] as const;
/** Textblocks — nodes whose content is inline. */
export const TEXTBLOCKS = ["paragraph", "heading"] as const;
/** Atoms: no content, no attrs. */
export const ATOM_BLOCKS = ["pageBreak", "priceTable"] as const;

/* Caps (spec §12.2). */
export const MAX_NODES = 2000;
/** JSON.stringify(doc).length after sanitizing (characters ≈ bytes for this content). */
export const MAX_JSON_CHARS = 200 * 1024;
/** Text characters per textblock (paragraph / heading). */
export const MAX_BLOCK_TEXT = 20000;
/** Nesting: the doc is depth 0; a node deeper than this is dropped. */
export const MAX_DEPTH = 12;
/** Raw nodes the sanitizer will look at before it stops reading (bounds work on hostile input). */
export const MAX_RAW_VISITS = 50000;
export const MAX_REF = 200;
export const MAX_SECTION_ID = 64;
export const MAX_LINE_KEY = 32;
export const MAX_SKU = 128;

/** An ordered list's `start` (when not 1). */
export const LIST_START_MIN = 1;
export const LIST_START_MAX = 9999;

export const PHOTO_WIDTH_MIN = 25;
export const PHOTO_WIDTH_MAX = 100;
/** Today's narrative float: the photo sits 34 % wide on the right. */
export const DEFAULT_PHOTO: PhotoAttrs = { show: true, align: "right", width: 34 };

export const isChipKind = (v: unknown): v is ChipKind => typeof v === "string" && (CHIP_KINDS as readonly string[]).includes(v);
export const isPhotoAlign = (v: unknown): v is PhotoAlign => typeof v === "string" && (PHOTO_ALIGNS as readonly string[]).includes(v);
export const clampPhotoWidth = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(PHOTO_WIDTH_MAX, Math.max(PHOTO_WIDTH_MIN, Math.round(v))) : DEFAULT_PHOTO.width;

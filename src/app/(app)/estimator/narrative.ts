import type { KeyProduct, SpecItem, SpecSection } from "./types";
import { systemPrintsInBody } from "./quote-document-view";
import { isPlaceholderSku } from "@/lib/specs/record-keys";
/**
 * #281 — a system narrative's plain-text formatting, turned into printable
 * blocks. Pure (no React) so the test:specs harness can import it.
 *
 * Rules: a blank line (whitespace-only counts) starts a new group; inside a
 * group, consecutive lines starting with "- " (after leading whitespace) form
 * one bullet list (marker stripped, item trimmed), and any other consecutive
 * lines form one paragraph whose line breaks are kept (each line trimmed at
 * the end). Nothing is stored — the narrative stays the raw string.
 */
export type NarrativeBlock = { kind: "p"; lines: string[] } | { kind: "ul"; items: string[] };

const BULLET = /^\s*- /;

export function narrativeBlocks(text: string | null | undefined): NarrativeBlock[] {
  const blocks: NarrativeBlock[] = [];
  const lines = (text || "").replace(/\r\n?/g, "\n").split("\n");
  let cur: NarrativeBlock | null = null;
  for (const raw of lines) {
    if (!raw.trim()) {
      // A blank line closes whatever block is open.
      cur = null;
      continue;
    }
    if (BULLET.test(raw)) {
      const item = raw.replace(BULLET, "").trim();
      if (!cur || cur.kind !== "ul") {
        cur = { kind: "ul", items: [] };
        blocks.push(cur);
      }
      cur.items.push(item);
    } else {
      if (!cur || cur.kind !== "p") {
        cur = { kind: "p", lines: [] };
        blocks.push(cur);
      }
      cur.lines.push(raw.trimEnd());
    }
  }
  return blocks;
}

/* =====================================================================
 * #293 — key products. A system's narrative features chosen lines: each
 * prints a reusable paragraph (copied onto the quote) with the part's
 * photo beside it, in Narrative presentation only. Pure — the harness,
 * the client column, the server save and QuoteDocument all share it.
 * ===================================================================== */

export const MAX_KEY_PRODUCTS = 20;
export const MAX_PARAGRAPH = 4000;
export const MAX_INTRO = 8000;
/** keyProductLibraryAction reads at most this many skus per call. */
export const MAX_LIBRARY_SKUS = 200;

/** What Draft narrative and the chip need about one sku's library entry. */
export type LibraryInfo = { inCatalog: boolean; desc: string; paragraph: string | null };
/** keyProductLibraryAction's row (one per requested sku). */
export type KeyProductLibraryRow = LibraryInfo & {
  paragraphUpdatedAt: number | null;
  paragraphUpdatedBy: string | null;
  /** The part's primary visible image (visibleImagesForParts()[sku][0]). */
  photoDocId: string | null;
  /** What the document prints instead when there is no photo: the part's
   *  manufacturer image (Manufacturer section Part 1), else null. */
  fallbackDocId: string | null;
  /** The manufacturer name that image belongs to (the column's hint). */
  fallbackLabel: string | null;
};
/** saveProductParagraphAction's answer — declared here because a "use server"
 *  file may export only async functions. */
export type ParagraphSaveResponse =
  | { ok: true; row: KeyProductLibraryRow }
  | { ok: false; error: string; stale?: { paragraph: string | null; updatedAt: number | null } };

/** sanitizeKeyProducts caps a stored sku at this length, so a longer one can
 *  never round-trip a save — such a line is not eligible (no star). */
const MAX_SKU = 128;
/** The line's own sku, trimmed ("" past MAX_SKU) — the pre-Part-1 anchor. */
const realSkuOf = (it: Pick<SpecItem, "sku"> | null | undefined): string => {
  const s = it && typeof it.sku === "string" ? it.sku.trim() : "";
  return s.length > MAX_SKU ? "" : s;
};
/** A key product's anchor sku: the line's real sku, or `line:<id>` for a
 *  line with no usable sku (Manufacturer section Part 1) — an allowance line,
 *  or a custom line whose sku is blank, too long, or a generic placeholder
 *  the Estimator writes ("CUSTOM", "AI"…, `isPlaceholderSku`). A custom line
 *  saved to the catalog keeps its real sku and anchors on it like any part,
 *  so its own photo and library paragraph still load. A token is unique per
 *  line, so two generic CUSTOM lines can both be featured, and a token never
 *  reaches the catalog, the library or a photo read. */
const skuOf = (it: Pick<SpecItem, "sku" | "id" | "allowance" | "custom"> | null | undefined): string => {
  if (!it) return "";
  if (it.allowance) return `line:${it.id}`;
  const real = realSkuOf(it);
  if (it.custom && (!real || isPlaceholderSku(real))) return `line:${it.id}`;
  return real;
};
/** The anchor a new block on this line takes (the ★, the + Key product picker). */
export const keyProductSkuOf = (it: Pick<SpecItem, "sku" | "id" | "allowance" | "custom">): string => skuOf(it);
export const isLineToken = (sku: string): boolean => typeof sku === "string" && /^line:\d+$/.test(sku);
/** Does a saved block's sku still anchor on this line? The current anchor, or
 *  — for a tokenized line featured before Part 1 — its real sku, so
 *  existing saved quotes resolve exactly as before. */
const anchorsOn = (item: SpecItem, sku: string): boolean => {
  const cur = skuOf(item);
  if (cur === sku) return true;
  return isLineToken(cur) && !!sku && !isLineToken(sku) && realSkuOf(item) === sku;
};

/** A line that can be featured: a real sku, and not labor / overhead /
 *  travel / the Rewards credit / an option (options print under Optional
 *  additions — featuring one would describe an item not in the total). */
export function isKeyProductEligible(it: SpecItem): boolean {
  if (!it || !skuOf(it)) return false;
  return !it.labor && !it.laborOverhead && !it.laborTravel && !it.rewardCredit && !it.option;
}

export type KeyProductResolution =
  | { kp: KeyProduct; status: "ok"; item: SpecItem }
  | { kp: KeyProduct; status: "missing" }
  | { kp: KeyProduct; status: "changed"; item: SpecItem }
  | { kp: KeyProduct; status: "ineligible"; item: SpecItem };

/** Each block against the section's lines: the id must exist, its sku must
 *  still match, and the line must still be eligible. */
export function resolveKeyProducts(sec: SpecSection): KeyProductResolution[] {
  const items = Array.isArray(sec?.items) ? sec.items : [];
  // Defensive (the print path reads saved JSON): a non-array list resolves
  // to nothing and a malformed row reads "missing" — never a throw. The
  // result stays index-aligned with sec.keyProducts.
  const kps: unknown[] = Array.isArray(sec?.keyProducts) ? sec.keyProducts : [];
  return kps.map((raw): KeyProductResolution => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { kp: { lineKey: "", sku: "", text: "", photo: false }, status: "missing" };
    const kp = raw as KeyProduct;
    const item = items.find((it) => it && String(it.id) === kp.lineKey);
    if (!item) return { kp, status: "missing" };
    if (!anchorsOn(item, kp.sku)) return { kp, status: "changed", item };
    if (!isKeyProductEligible(item)) return { kp, status: "ineligible", item };
    return { kp, status: "ok", item };
  });
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const cleanText = (v: unknown, max: number): string => (typeof v === "string" ? v : "").replace(/\r\n?/g, "\n").trim().slice(0, max);

/** Shape-clean for save: drop malformed rows and unknown keys, trim, cap
 *  counts and lengths, dedupe by lineKey then sku (first wins). Does NOT
 *  drop unresolved blocks — the editor shows them flagged until removed. */
export function sanitizeKeyProducts(raw: unknown): KeyProduct[] {
  if (!Array.isArray(raw)) return [];
  const out: KeyProduct[] = [];
  const keys = new Set<string>();
  const skus = new Set<string>();
  for (const r of raw) {
    if (out.length >= MAX_KEY_PRODUCTS) break;
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const o = r as Record<string, unknown>;
    const lineKey = strOf(o.lineKey).trim().slice(0, 32);
    const sku = strOf(o.sku).trim().slice(0, MAX_SKU);
    if (!lineKey || !sku || keys.has(lineKey) || skus.has(sku)) continue;
    keys.add(lineKey);
    skus.add(sku);
    out.push({ lineKey, sku, text: cleanText(o.text, MAX_PARAGRAPH), photo: typeof o.photo === "boolean" ? o.photo : true });
  }
  return out;
}

/** The section with these blocks — an empty / absent list removes the key so
 *  a section without blocks stays byte-identical to a pre-#293 one. */
export function withKeyProducts<T extends SpecSection>(sec: T, kps: KeyProduct[] | undefined): T {
  const out = { ...sec };
  if (kps && kps.length) out.keyProducts = kps;
  else delete out.keyProducts;
  return out;
}

/** Server-side save rule: a section that never had the key passes through
 *  untouched (same object); one that has it is sanitized. */
export function withSanitizedKeyProducts<T extends SpecSection>(sec: T): T {
  if (!sec || typeof sec !== "object" || !("keyProducts" in sec)) return sec;
  return withKeyProducts(sec, sanitizeKeyProducts(sec.keyProducts));
}

/** Re-anchor after a re-id (same-estimate Copy, Load system). Blocks whose
 *  old id isn't in the map are dropped. */
export function remapKeyProducts(kps: KeyProduct[] | undefined, idMap: ReadonlyMap<number, number>): KeyProduct[] | undefined {
  if (!kps) return undefined;
  const out: KeyProduct[] = [];
  for (const kp of kps) {
    const n = Number(kp.lineKey);
    const next = Number.isFinite(n) ? idMap.get(n) : undefined;
    if (next == null) continue;
    // A line token names the line id, so it follows the re-id.
    out.push(isLineToken(kp.sku) ? { ...kp, lineKey: String(next), sku: `line:${next}` } : { ...kp, lineKey: String(next) });
  }
  return out;
}

/** The ★ on a line: on (a block anchors here), off (can be marked), full
 *  (MAX_KEY_PRODUCTS reached), dupSku (another line with this sku is
 *  already featured), none (ineligible — no star). */
export type KeyProductStar = "on" | "off" | "full" | "dupSku" | "none";
export function keyProductStar(sec: SpecSection, it: SpecItem): KeyProductStar {
  if (!isKeyProductEligible(it)) return "none";
  const kps = sec.keyProducts || [];
  if (kps.some((k) => k.lineKey === String(it.id))) return "on";
  if (kps.some((k) => k.sku === skuOf(it))) return "dupSku";
  if (kps.length >= MAX_KEY_PRODUCTS) return "full";
  return "off";
}

/** Mark one line (the ★ or "+ Key product"); a no-op unless its star is off. */
export function markKeyProduct(sec: SpecSection, itemId: number, libraryText: string): SpecSection {
  const it = sec.items.find((i) => i.id === itemId);
  if (!it || keyProductStar(sec, it) !== "off") return sec;
  const block: KeyProduct = { lineKey: String(it.id), sku: skuOf(it), text: (libraryText || "").slice(0, MAX_PARAGRAPH), photo: true };
  return withKeyProducts(sec, [...(sec.keyProducts || []), block]);
}

/** The ★ click: off → mark (with the library text if loaded), on → remove. */
export function toggleKeyProduct(sec: SpecSection, itemId: number, libraryText: string): SpecSection {
  const it = sec.items.find((i) => i.id === itemId);
  if (!it) return sec;
  if (keyProductStar(sec, it) === "on") return withKeyProducts(sec, (sec.keyProducts || []).filter((k) => k.lineKey !== String(itemId)));
  return markKeyProduct(sec, itemId, libraryText);
}

/** The ★'s late fill: once the library row arrives, copy its paragraph onto
 *  the block anchored at `itemId` — only while that block still features
 *  `sku` and its text is still empty (a user's typing always wins). */
export function fillEmptyKeyProductText(sec: SpecSection, itemId: number, sku: string, text: string): SpecSection {
  // A line token has no library paragraph to copy.
  if (isLineToken(sku)) return sec;
  const kps = Array.isArray(sec.keyProducts) ? sec.keyProducts : [];
  const i = kps.findIndex((k) => k.lineKey === String(itemId) && k.sku === sku);
  if (i < 0 || !text || (kps[i].text || "").trim()) return sec;
  return patchKeyProduct(sec, i, { text });
}

export function moveKeyProduct(sec: SpecSection, index: number, dir: -1 | 1): SpecSection {
  const kps = [...(sec.keyProducts || [])];
  const j = index + dir;
  if (index < 0 || index >= kps.length || j < 0 || j >= kps.length) return sec;
  [kps[index], kps[j]] = [kps[j], kps[index]];
  return withKeyProducts(sec, kps);
}

export function removeKeyProduct(sec: SpecSection, index: number): SpecSection {
  const kps = sec.keyProducts || [];
  if (index < 0 || index >= kps.length) return sec;
  return withKeyProducts(sec, kps.filter((_, i) => i !== index));
}

export function patchKeyProduct(sec: SpecSection, index: number, patch: Partial<Pick<KeyProduct, "text" | "photo">>): SpecSection {
  const kps = sec.keyProducts || [];
  if (index < 0 || index >= kps.length) return sec;
  const cur = kps[index];
  const next: KeyProduct = {
    ...cur,
    ...("text" in patch ? { text: String(patch.text ?? "").slice(0, MAX_PARAGRAPH) } : {}),
    ...(typeof patch.photo === "boolean" ? { photo: patch.photo } : {}),
  };
  return withKeyProducts(sec, kps.map((k, i) => (i === index ? next : k)));
}

/** "Re-anchor" on a `changed` block: adopt the line's current sku, keep the
 *  text. Refused when another block already features that sku. */
export function reanchorKeyProduct(sec: SpecSection, index: number): SpecSection {
  const r = resolveKeyProducts(sec)[index];
  if (!r || r.status !== "changed") return sec;
  const sku = skuOf(r.item);
  const kps = sec.keyProducts || [];
  if (!sku || kps.some((k, i) => i !== index && k.sku === sku)) return sec;
  return withKeyProducts(sec, kps.map((k, i) => (i === index ? { ...k, sku } : k)));
}

/** "+ Key product" picker: eligible lines whose star is off, one per sku. */
export function unmarkedEligibleLines(sec: SpecSection): SpecItem[] {
  const seen = new Set<string>();
  return sec.items.filter((it) => {
    if (keyProductStar(sec, it) !== "off") return false;
    const s = skuOf(it);
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

export type KeyProductChip = "needs" | "library" | "edited" | "custom";
export const KEY_PRODUCT_CHIP_LABEL: Record<KeyProductChip, string> = {
  needs: "Needs a paragraph",
  library: "From library",
  edited: "Edited",
  custom: "Not in catalog",
};
/** The library-status chip; null while the sku's row isn't loaded. */
export function keyProductChip(kp: KeyProduct, row: LibraryInfo | undefined): KeyProductChip | null {
  if (!row) return null;
  if (!row.inCatalog) return "custom";
  if (row.paragraph == null) return "needs";
  return kp.text.trim() === row.paragraph.trim() ? "library" : "edited";
}

/** The text Draft narrative copies onto a block: the library paragraph,
 *  else the catalog description, else the line's own description. */
function draftTextFor(item: SpecItem, lib: LibraryInfo | undefined): string {
  return (lib?.paragraph ?? (lib?.desc || item.desc || "")).slice(0, MAX_PARAGRAPH);
}
const normIntro = (intro: string | null): string | null => (intro == null ? null : intro.replace(/\r\n?/g, "\n").trim().slice(0, MAX_INTRO));

/** Draft narrative: the chosen intro + each resolved block's library
 *  paragraph (else the catalog description as starting text). "replace"
 *  overwrites; "blanks" fills only an empty narrative / empty block text.
 *  Always switches the system to Narrative. Unresolved blocks are never
 *  touched. Returns which skus still need a paragraph (no library text). */
export function draftNarrative(
  sec: SpecSection,
  intro: string | null,
  library: ReadonlyMap<string, LibraryInfo>,
  mode: "replace" | "blanks"
): { section: SpecSection; needsParagraph: string[]; changed: boolean } {
  const introText = normIntro(intro);
  const curNarr = sec.narrative || "";
  const narrative = introText == null ? curNarr : mode === "replace" || !curNarr.trim() ? introText : curNarr;
  const needs: string[] = [];
  const res = resolveKeyProducts(sec);
  const before = sec.keyProducts || [];
  const kps = before.map((kp, i) => {
    const r = res[i];
    // A line-token block (allowance/custom line) has no library or catalog
    // text: its paragraph is always hand-written, so Draft never touches it.
    if (r.status !== "ok" || isLineToken(kp.sku)) return kp;
    const lib = library.get(kp.sku);
    if (lib?.paragraph == null && !needs.includes(kp.sku)) needs.push(kp.sku);
    if (mode === "blanks" && kp.text.trim()) return kp;
    const text = draftTextFor(r.item, lib);
    return text === kp.text ? kp : { ...kp, text };
  });
  const changed =
    (sec.presentation || "itemized") !== "narrative" ||
    (introText != null && narrative !== curNarr) ||
    kps.some((k, i) => k !== before[i]);
  if (!changed) return { section: sec, needsParagraph: needs, changed: false };
  const base: SpecSection = { ...sec, presentation: "narrative", ...(introText != null ? { narrative } : {}) };
  return { section: sec.keyProducts ? withKeyProducts(base, kps) : base, needsParagraph: needs, changed: true };
}

/** Would "replace" overwrite something already written? (Draft asks first.) */
export function draftOverwrites(sec: SpecSection, intro: string | null, library: ReadonlyMap<string, LibraryInfo>): boolean {
  const introText = normIntro(intro);
  const cur = (sec.narrative || "").trim();
  if (introText != null && cur && cur !== introText) return true;
  return resolveKeyProducts(sec).some(
    (r) => r.status === "ok" && !isLineToken(r.kp.sku) && r.kp.text.trim() !== "" && r.kp.text.trim() !== draftTextFor(r.item, library.get(r.kp.sku)).trim()
  );
}

/** The customer-facing heading: the line's description, with the same
 *  allowance prefix QuoteDocument's itemized rows print. */
export function keyProductHeading(it: SpecItem): string {
  return it.allowance ? "Budget allowance — " + it.desc : it.desc;
}

export type PrintableKeyProduct = {
  sku: string;
  heading: string;
  blocks: NarrativeBlock[];
  photo: boolean;
  /** An allowance / custom line: what prints when the block has no photo of
   *  its own (Manufacturer section Part 1). Absent on every other block. */
  placeholder?: "allowance" | "custom-device";
};
/** What prints for a narrative system: resolved "ok" blocks in order. */
export function printableKeyProducts(sec: SpecSection): PrintableKeyProduct[] {
  return resolveKeyProducts(sec).flatMap((r) =>
    r.status === "ok"
      ? [
          {
            sku: r.kp.sku,
            heading: keyProductHeading(r.item),
            blocks: narrativeBlocks(typeof r.kp.text === "string" ? r.kp.text : ""),
            photo: r.kp.photo !== false,
            ...(r.item.allowance ? { placeholder: "allowance" as const } : r.item.custom ? { placeholder: "custom-device" as const } : {}),
          },
        ]
      : []
  );
}

/** Skus whose photo the document prints: printed (revenue-carrying)
 *  narrative systems' printable blocks with photo on, deduped, in document
 *  order — a system the body skips never costs a photo read. */
export function photoSkusOf(sections: SpecSection[]): string[] {
  return printedPhotoSkus(sections, () => true);
}

/** The photo skus that may take their manufacturer's image when the part has
 *  no photo of its own: not a placeholder block (a custom line on a real
 *  catalog sku, or a legacy allowance/custom block — the kind placeholder
 *  comes before the manufacturer image in the chain). */
export function manufacturerFallbackSkusOf(sections: SpecSection[]): string[] {
  return printedPhotoSkus(sections, (p) => !p.placeholder);
}

/** Line tokens never reach a catalog/photo read (they print a placeholder). */
function printedPhotoSkus(sections: SpecSection[], keep: (p: PrintableKeyProduct) => boolean): string[] {
  const out: string[] = [];
  for (const sec of Array.isArray(sections) ? sections : []) {
    if (!sec || (sec.presentation || "itemized") !== "narrative" || !systemPrintsInBody(sec)) continue;
    for (const p of printableKeyProducts(sec)) if (p.photo && !isLineToken(p.sku) && keep(p) && !out.includes(p.sku)) out.push(p.sku);
  }
  return out;
}

import type { KeyProduct, SpecItem, SpecSection } from "./types";
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
};
/** saveProductParagraphAction's answer — declared here because a "use server"
 *  file may export only async functions. */
export type ParagraphSaveResponse =
  | { ok: true; row: KeyProductLibraryRow }
  | { ok: false; error: string; stale?: { paragraph: string | null; updatedAt: number | null } };

const skuOf = (it: Pick<SpecItem, "sku"> | null | undefined): string => (it && typeof it.sku === "string" ? it.sku.trim() : "");

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
  return (sec?.keyProducts || []).map((kp): KeyProductResolution => {
    const item = items.find((it) => String(it.id) === kp.lineKey);
    if (!item) return { kp, status: "missing" };
    if (skuOf(item) !== kp.sku) return { kp, status: "changed", item };
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
    const sku = strOf(o.sku).trim();
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
    if (next != null) out.push({ ...kp, lineKey: String(next) });
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
    if (r.status !== "ok") return kp;
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
    (r) => r.status === "ok" && r.kp.text.trim() !== "" && r.kp.text.trim() !== draftTextFor(r.item, library.get(r.kp.sku)).trim()
  );
}

/** The customer-facing heading: the line's description, with the same
 *  allowance prefix QuoteDocument's itemized rows print. */
export function keyProductHeading(it: SpecItem): string {
  return it.allowance ? "Budget allowance — " + it.desc : it.desc;
}

export type PrintableKeyProduct = { sku: string; heading: string; blocks: NarrativeBlock[]; photo: boolean };
/** What prints for a narrative system: resolved "ok" blocks in order. */
export function printableKeyProducts(sec: SpecSection): PrintableKeyProduct[] {
  return resolveKeyProducts(sec).flatMap((r) =>
    r.status === "ok" ? [{ sku: r.kp.sku, heading: keyProductHeading(r.item), blocks: narrativeBlocks(r.kp.text), photo: r.kp.photo }] : []
  );
}

/** Skus whose photo the document prints: narrative systems' printable
 *  blocks with photo on, deduped, in document order. */
export function photoSkusOf(sections: SpecSection[]): string[] {
  const out: string[] = [];
  for (const sec of sections || []) {
    if ((sec?.presentation || "itemized") !== "narrative") continue;
    for (const p of printableKeyProducts(sec)) if (p.photo && !out.includes(p.sku)) out.push(p.sku);
  }
  return out;
}

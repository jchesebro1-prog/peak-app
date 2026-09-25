import {
  slotCoverage,
  type CoverageIndex,
  type DocRef,
  type SlotCoverage,
} from "./coverage";
import type { QuotedPartStat } from "./quoted-parts";
import type { PartDocKind } from "./types";

/**
 * Serializable view models for the Datasheets page and the part editor
 * (#DOC). Pure. The server computes these from one CoverageIndex; client
 * components receive only these small objects, never the collections.
 */

export type PartRef = { sku: string; desc: string };

export type SlotView =
  | { state: "own"; docs: DocRef[] }
  | { state: "not-needed" }
  | { state: "covered"; docs: DocRef[]; parents: PartRef[] }
  | { state: "link-only"; docs: DocRef[]; urls: string[]; error: string | null }
  | { state: "missing" };

export function toSlotView(s: SlotCoverage, index: CoverageIndex, descOf: (sku: string) => string): SlotView {
  switch (s.state) {
    case "own":
    case "not-needed":
    case "missing":
      return s;
    case "covered":
      return { state: "covered", docs: s.docs, parents: s.parents.map((sku) => ({ sku, desc: descOf(sku) })) };
    case "link-only": {
      let error: string | null = null;
      let at = -1;
      for (const d of s.docs) {
        const f = index.docsById.get(d.id)?.lastFetch;
        if (f && !f.ok && f.at > at) {
          at = f.at;
          error = f.error || "Fetch failed.";
        }
      }
      return { state: "link-only", docs: s.docs, urls: s.urls, error };
    }
  }
}

export function slotViewFor(index: CoverageIndex, sku: string, kind: PartDocKind, descOf: (sku: string) => string): SlotView {
  return toSlotView(slotCoverage(index, sku, kind), index, descOf);
}

/** The same answer as coverage.slotSatisfied, on a view. */
export function viewSatisfied(v: SlotView): boolean {
  return v.state === "own" || v.state === "not-needed" || v.state === "covered";
}

export type DocumentRow = {
  sku: string;
  mfr: string;
  model: string;
  desc: string;
  category: string;
  quotes: number;
  lastQuotedAt: number | null;
  datasheet: SlotView;
  specsheet: SlotView;
};

export type RowPart = { sku: string; desc: string; category: string; mfr?: string; manufacturerModelNumber?: string; manufacturerPartNumber?: string };

export function documentRow(stat: QuotedPartStat, part: RowPart, index: CoverageIndex, descOf: (sku: string) => string): DocumentRow {
  return {
    sku: part.sku,
    mfr: part.mfr || "",
    model: part.manufacturerModelNumber || part.manufacturerPartNumber || "",
    desc: part.desc,
    category: part.category || "",
    quotes: stat.quotes,
    lastQuotedAt: stat.lastQuotedAt,
    datasheet: slotViewFor(index, part.sku, "datasheet", descOf),
    specsheet: slotViewFor(index, part.sku, "specsheet", descOf),
  };
}

export type DocumentsShow = "all" | "missing-datasheet" | "missing-specsheet" | "link" | "covered";
export const DOCUMENTS_SHOW: Array<{ value: DocumentsShow; label: string }> = [
  { value: "all", label: "All quoted parts" },
  { value: "missing-datasheet", label: "Missing datasheet" },
  { value: "missing-specsheet", label: "Missing spec sheet" },
  { value: "link", label: "Link to fetch" },
  { value: "covered", label: "Covered by a fixture" },
];

export type DocumentsFilter = { show: DocumentsShow; mfr: string; cat: string; q: string };

export function parseDocumentsFilter(sp: Record<string, string | string[] | undefined>): DocumentsFilter {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
  const show = one(sp.show) as DocumentsShow;
  return {
    show: DOCUMENTS_SHOW.some((s) => s.value === show) ? show : "all",
    mfr: one(sp.mfr).trim(),
    cat: one(sp.cat).trim(),
    q: one(sp.q).trim(),
  };
}

export function documentRowMatches(r: DocumentRow, f: DocumentsFilter): boolean {
  if (f.mfr && r.mfr !== f.mfr) return false;
  if (f.cat && r.category !== f.cat) return false;
  if (f.show === "missing-datasheet" && viewSatisfied(r.datasheet)) return false;
  if (f.show === "missing-specsheet" && viewSatisfied(r.specsheet)) return false;
  if (f.show === "link" && r.datasheet.state !== "link-only" && r.specsheet.state !== "link-only") return false;
  if (f.show === "covered" && r.datasheet.state !== "covered" && r.specsheet.state !== "covered") return false;
  if (f.q) {
    const hay = `${r.sku} ${r.mfr} ${r.model} ${r.desc}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t))) return false;
  }
  return true;
}

/** "412 of 1,180 quoted parts have a datasheet" (spec §3). */
export function progressLine(rows: readonly DocumentRow[], kind: PartDocKind): string {
  const done = rows.filter((r) => viewSatisfied(r[kind])).length;
  const noun = kind === "datasheet" ? "a datasheet" : "a spec sheet";
  return `${done.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} quoted parts have ${noun}`;
}

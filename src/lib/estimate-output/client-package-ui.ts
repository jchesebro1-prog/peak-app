import { datasheetExclusion, type DatasheetExclusion } from "@/lib/part-docs/exclusions";
import type { ClientDatasheetRow } from "./package-preview";
import { systemPrintsInBody } from "@/app/(app)/estimator/quote-document-view";
import type { SpecSection } from "@/app/(app)/estimator/types";
import type { SystemGroup } from "@/lib/estimate-groups/groups";

/**
 * #333 (spec 2026-10-12 §4.4) — the Build package step's Client package tab:
 * its copy, anchors and every rule the tab shows, kept pure (client-safe) so
 * the harness pins them. The tab component only wires these to the hook.
 */

export const CLIENT_PACKAGE_ANCHORS = { documents: "documents", systems: "systems", lineDetail: "line-detail", datasheets: "datasheets" } as const;
export const CLIENT_PACKAGE_ANCHOR_IDS: readonly string[] = Object.values(CLIENT_PACKAGE_ANCHORS);

export const CLIENT_PACKAGE_COPY = {
  documents: "Documents",
  estimatePdf: "Estimate PDF",
  estimatePdfHint: "Attached when you send (Send & track)",
  coverPdf: "Cover PDF",
  coverPdfHint: "Attached when you send",
  download: "Download ↗",
  appendix: "BOM (itemized) appendix",
  appendixHint: "Every narrative system's full line list after the signature",
  cutSheets: (n: number) => `Cut sheets (${n})`,
  cutSheetsHint: "Client-style cut sheets after the estimate",
  noCurtains: "This quote has no curtains.",
  viewCutSheets: "View cut sheets ↗",
  drawings: (n: number | null) => (n == null ? "Drawings" : `Drawings (${n})`),
  drawingsHint: "Plans & risers on the client's package page",
  saveForDrawings: "Save the estimate to add drawings.",
  systems: "Systems",
  narrative: "Narrative",
  itemized: "Itemized",
  alternate: "Alternate",
  noIntro: "Narrative with no intro",
  noSystems: "No systems with items yet — add them on Build.",
  unpriced: "No price yet — not on the PDF",
  truncated: (n: number) => `List truncated — ${n} ${n === 1 ? "item" : "items"} not checked`,
  selectionFailed: "Couldn't save package choices —",
  lineDetail: "Estimate PDF — line detail",
  datasheets: "Datasheets",
  checking: "Checking datasheets…",
  loadFailed: "Couldn't load datasheets —",
  retry: "Retry",
  includeAll: "Include all",
  leaveAllOut: "Leave all out",
  noRows: "No catalog products on this estimate yet.",
  noFiltered: "Nothing here.",
  partOf: (desc: string) => `Part of: ${desc}`,
  missing: "Missing",
  notNeeded: "Not needed (catalog)",
  coveredBy: (who: string) => `covered by ${who}`,
  leftOut: "Left out",
  leftOutWith: (who: string) => `Left out with ${who}`,
  followsFixture: (who: string) => `Follows ${who} — tick ${who} to send it.`,
  saving: "Saving…",
  saved: "Saved",
  saveFailed: "Not saved",
  ridesSave: "Saved with the estimate",
  sentNote: (rev: number) => `The client's link shows Rev ${rev} as sent. Changes here go out with the next send.`,
} as const;

export const DATASHEET_FILTERS = ["all", "missing", "leftOut"] as const;
export type DatasheetFilter = (typeof DATASHEET_FILTERS)[number];
export const DATASHEET_FILTER_LABEL: Record<DatasheetFilter, string> = { all: "All", missing: "Missing", leftOut: "Left out" };

export type ClientRowView = {
  row: ClientDatasheetRow;
  /** How this project's choices leave the datasheet out, or null (it goes). */
  exclusion: DatasheetExclusion | null;
  /** The checkbox: ticked = goes to the client. */
  checked: boolean;
  /** Not-needed rows (nothing to send) and rows left out with their fixture (they follow it) have no live checkbox. */
  selectable: boolean;
  /** The datasheet state, read-only. */
  status: { kind: "link"; href: string; name: string } | { kind: "note"; text: string };
  /** What leaving it out does ("Left out" / "Left out with S4-26"), or null when it goes. */
  effect: string | null;
  /** Why the checkbox can't be ticked (not selectable), else null. */
  lockReason: string | null;
};

/** A fixture SKU → how the tab names it (its model when it is a row here). */
function namer(rows: readonly ClientDatasheetRow[]): (sku: string) => string {
  const bySku = new Map(rows.map((r) => [r.sku, r] as const));
  return (sku) => bySku.get(sku)?.model || sku;
}

/** The rows with this project's left-out SKUs applied (part-docs/exclusions.ts — the server's own rule). */
export function clientRowViews(rows: readonly ClientDatasheetRow[], excludedDatasheets: readonly string[]): ClientRowView[] {
  const excluded = new Set(excludedDatasheets);
  const name = namer(rows);
  return rows.map((row) => {
    const exclusion = datasheetExclusion({ sku: row.sku, state: row.state, coveredBy: row.coveredBy }, excluded);
    const who = row.coveredBy.map(name).join(", ");
    const status: ClientRowView["status"] =
      row.state === "not-needed"
        ? { kind: "note", text: CLIENT_PACKAGE_COPY.notNeeded }
        : row.state === "missing"
          ? { kind: "note", text: CLIENT_PACKAGE_COPY.missing }
          : row.state === "covered"
            ? { kind: "note", text: CLIENT_PACKAGE_COPY.coveredBy(who) }
            : row.datasheet
              ? { kind: "link", href: row.datasheet.href, name: row.datasheet.name }
              : { kind: "note", text: CLIENT_PACKAGE_COPY.missing };
    const effect = exclusion === "parent" ? CLIENT_PACKAGE_COPY.leftOutWith(who) : exclusion === "self" && row.state !== "not-needed" ? CLIENT_PACKAGE_COPY.leftOut : null;
    return {
      row,
      exclusion,
      checked: row.state !== "not-needed" && exclusion === null,
      selectable: row.state !== "not-needed" && exclusion !== "parent",
      status,
      effect,
      lockReason: row.state === "not-needed" ? CLIENT_PACKAGE_COPY.notNeeded : exclusion === "parent" ? CLIENT_PACKAGE_COPY.followsFixture(who) : null,
    };
  });
}

/** All · Missing (no datasheet and still going — the gaps) · Left out. */
export function filterRowViews(views: readonly ClientRowView[], filter: DatasheetFilter): ClientRowView[] {
  if (filter === "missing") return views.filter((v) => v.row.state === "missing" && v.exclusion === null);
  if (filter === "leftOut") return views.filter((v) => v.exclusion !== null && v.row.state !== "not-needed");
  return [...views];
}

/** Rows with something to send (not-needed ones never count): how many go, of how many, and how many of those have no datasheet yet. */
export function datasheetCounts(views: readonly ClientRowView[]): { included: number; total: number; missing: number } {
  const real = views.filter((v) => v.row.state !== "not-needed");
  const going = real.filter((v) => v.exclusion === null);
  return { included: going.length, total: real.length, missing: going.filter((v) => v.row.state === "missing").length };
}

/** "41 of 45 go to the client · 2 missing". */
export function datasheetCountsLine(c: { included: number; total: number; missing: number }): string {
  return `${c.included} of ${c.total} go to the client` + (c.missing ? ` · ${c.missing} missing` : "");
}

/** Include all / Leave all out act on the FILTERED rows only: the SKUs to tick back in, or to leave out. */
export function bulkTargets(filtered: readonly ClientRowView[], action: "include" | "leaveOut"): string[] {
  if (action === "include") return filtered.filter((v) => v.selectable && v.exclusion === "self").map((v) => v.row.sku);
  return filtered.filter((v) => v.selectable && v.exclusion === null).map((v) => v.row.sku);
}

/** The datasheet list as shown: rows in BOM order, assembly members indented under a "Part of" header (one header per run). */
export type DatasheetListItem = { kind: "header"; key: string; text: string } | { kind: "row"; key: string; view: ClientRowView; indent: boolean };
export function datasheetListItems(views: readonly ClientRowView[]): DatasheetListItem[] {
  const out: DatasheetListItem[] = [];
  let open: string | null = null;
  for (const v of views) {
    const parent = v.row.partOf[0] ?? null;
    if (parent && parent !== open) out.push({ kind: "header", key: `h:${v.row.sku}`, text: CLIENT_PACKAGE_COPY.partOf(v.row.partOf.join(" · ")) });
    open = parent;
    out.push({ kind: "row", key: v.row.sku, view: v, indent: !!parent });
  }
  return out;
}

/** readiness.ts's package rule, per system: a printed narrative system with a blank intro. */
export function narrativeNeedsIntro(sec: SpecSection): boolean {
  return systemPrintsInBody(sec) && sec.presentation === "narrative" && !(sec.narrative || "").trim();
}

export type SystemListItem =
  | { kind: "group"; key: string; name: string }
  | { kind: "system"; key: string; id: string; name: string; presentation: "itemized" | "narrative"; alternate: boolean; noIntro: boolean; unpriced: boolean };

/** The Systems group — the ONE presentation editor, so it lists every system
 *  with items (#333 review O: a zero-revenue system used to have no control
 *  anywhere), `unpriced` marking one that doesn't print yet; plus any system
 *  that prints without items. In the editor's normalised order, under its
 *  group's heading when it has one. */
export function systemListItems(sections: readonly SpecSection[], groups: readonly SystemGroup[] | undefined): SystemListItem[] {
  const names = new Map((groups || []).map((g) => [g.id, g.name] as const));
  const out: SystemListItem[] = [];
  let open: string | null = null;
  for (const sec of sections) {
    const prints = systemPrintsInBody(sec);
    if (!prints && !(sec.items || []).length) continue;
    const gid = sec.groupId && names.has(sec.groupId) ? sec.groupId : null;
    if (gid && gid !== open) out.push({ kind: "group", key: `g:${gid}:${sec.id}`, name: names.get(gid) || "" });
    open = gid;
    out.push({
      kind: "system",
      key: sec.id,
      id: sec.id,
      name: sec.name || "Untitled system",
      presentation: (sec.presentation || "itemized") === "narrative" ? "narrative" : "itemized",
      alternate: sec.alternate === true,
      noIntro: narrativeNeedsIntro(sec),
      unpriced: !prints,
    });
  }
  return out;
}

/**
 * The Grid — equipment schedule (D113 item 3), shared by /schedule and the
 * drawing set's E-60x sheets (#GDS). Pure and dependency-free (the grid-bom
 * rule). Deliberately NO prices: this is the field document.
 */

import { formatMeasure, type MeasureUnit } from "@/lib/annotations";
import { spaceOf, type SpaceLite } from "./grid-geometry";
import { curtainDesc, type GridCurtain } from "./grid-bom";

/** `code` overrides the printed Part cell for rows with no SKU (curtains). */
export type ScheduleRow = { partId: string; code?: string; desc: string; qty: number };
export type ScheduleSection = { key: string; name: string; rows: ScheduleRow[] };
export type ScheduleWire = { id: string; partId: string; fromName: string; toName: string; lengthFt: number | null; unit: string };
export type ScheduleData = {
  sections: ScheduleSection[];
  wires: ScheduleWire[];
  deviceCount: number;
  wireFeet: Array<{ partId: string; ft: number; unit: string; unmeasured: number }>;
};

/**
 * Devices grouped per space (the same computed smallest-wins assignment as
 * everywhere else), spaces in drawing order, then Unassigned. Curtains never
 * group: each drop is its own made-to-size drape.
 */
export function buildSchedule(input: {
  placements: Array<{ id: string; sheetId: string; page: number; x: number; y: number; partId: string; curtain?: GridCurtain | null }>;
  spaces: Array<SpaceLite & { name: string }>;
  descOf: (partId: string) => string | undefined;
  wires: ScheduleWire[];
}): ScheduleData {
  const bySpace = new Map<string | null, ScheduleRow[]>();
  for (const pl of input.placements) {
    const home = spaceOf(pl, input.spaces);
    const key = home ? home.id : null;
    const rows = bySpace.get(key) || [];
    if (pl.curtain) {
      rows.push({ partId: pl.id, code: "CURTAIN", desc: curtainDesc(pl.curtain, input.descOf(pl.curtain.fabricSku)), qty: 1 });
    } else {
      const row = rows.find((r) => r.partId === pl.partId && !r.code);
      if (row) row.qty += 1;
      else rows.push({ partId: pl.partId, desc: input.descOf(pl.partId) || "(no longer in the catalog)", qty: 1 });
    }
    bySpace.set(key, rows);
  }
  const sections: ScheduleSection[] = [
    ...input.spaces.filter((s) => bySpace.has(s.id)).map((s) => ({ key: s.id, name: s.name, rows: bySpace.get(s.id)! })),
    ...(bySpace.has(null) ? [{ key: "un", name: "Unassigned", rows: bySpace.get(null)! }] : []),
  ];
  const feet = new Map<string, { partId: string; ft: number; unit: string; unmeasured: number }>();
  for (const w of input.wires) {
    const f = feet.get(w.partId) || { partId: w.partId, ft: 0, unit: w.unit, unmeasured: 0 };
    if (w.lengthFt === null) f.unmeasured += 1;
    else f.ft += w.lengthFt;
    feet.set(w.partId, f);
  }
  return {
    sections,
    wires: input.wires,
    deviceCount: input.placements.filter((pl) => !pl.curtain).length,
    wireFeet: [...feet.values()],
  };
}

export type ScheduleHead = { kind: "section"; name: string; cont: boolean } | { kind: "wires"; cont: boolean };
export type ScheduleItem =
  | ScheduleHead
  | { kind: "row"; qty: number; code: string; desc: string }
  | { kind: "wire"; partId: string; run: string; length: string };
export type ScheduleGroup = { head: ScheduleHead; rows: ScheduleItem[] };

export function scheduleGroups(d: ScheduleData): ScheduleGroup[] {
  const groups: ScheduleGroup[] = d.sections.map((s) => ({
    head: { kind: "section", name: s.name, cont: false },
    rows: s.rows.map((r) => ({ kind: "row" as const, qty: r.qty, code: r.code || r.partId, desc: r.desc })),
  }));
  if (d.wires.length) {
    groups.push({
      head: { kind: "wires", cont: false },
      rows: d.wires.map((w) => ({
        kind: "wire" as const,
        partId: w.partId,
        run: `${w.fromName} → ${w.toName}`,
        length: w.lengthFt !== null ? formatMeasure(w.lengthFt, w.unit as MeasureUnit) : "unmeasured",
      })),
    });
  }
  return groups;
}

/**
 * Pages → columns → items. A head never ends a column (it needs at least one
 * row under it), and a group that spills into a new column repeats its head
 * marked `cont`. An empty schedule is still one (empty) sheet.
 */
export function paginateSchedule(groups: ScheduleGroup[], perColumn = 30, columns = 2): ScheduleItem[][][] {
  const cap = Math.max(2, Math.floor(perColumn));
  const cols = Math.max(1, Math.floor(columns));
  const pages: ScheduleItem[][][] = [];
  let page: ScheduleItem[][] = [];
  let col: ScheduleItem[] = [];
  const pushCol = () => {
    page.push(col);
    col = [];
    if (page.length === cols) {
      pages.push(page);
      page = [];
    }
  };
  for (const g of groups) {
    if (col.length && col.length + 2 > cap) pushCol();
    col.push(g.head);
    for (const r of g.rows) {
      if (col.length >= cap) {
        pushCol();
        col.push({ ...g.head, cont: true });
      }
      col.push(r);
    }
  }
  if (col.length) pushCol();
  if (page.length) pages.push(page);
  if (!pages.length) pages.push([[]]);
  return pages;
}

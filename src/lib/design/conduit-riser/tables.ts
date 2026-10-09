/**
 * Conduit riser (#321) — the six sheet tables, Bray's order: power types,
 * wire legend, line legend, equipment rack contents (one per rack), power
 * controls, box types. Each is returned only when it has rows. Text is
 * uppercased the way Bray prints. Pure — geometry is drawing.ts's job.
 */

import type { ConduitRiserDoc } from "./model";
import type { CRBoxType, CRWireType } from "./input";
import type { CRView } from "./derive";

export type TableKey = "power" | "wire" | "line" | "rack" | "controls" | "box";
export type TableColumn = { head: string; w: number };
export type TableModel = {
  key: TableKey;
  title: string;
  columns: TableColumn[];
  rows: string[][];
};

/** The line legend's two sample cells — drawing.ts draws a line here instead of text. */
export const LINE_SOLID = "\u0000solid";
export const LINE_DASHED = "\u0000dashed";

const U = (s: string) => s.toUpperCase();
const byNum = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export function riserTables(input: {
  view: CRView;
  doc: ConduitRiserDoc;
  wireTypes: readonly CRWireType[];
  boxTypes: readonly CRBoxType[];
}): TableModel[] {
  const out: TableModel[] = [];
  const { view, doc } = input;

  if (doc.powerTypes.length) {
    out.push({
      key: "power",
      title: "POWER TYPES",
      columns: [{ head: "SYMBOL", w: 0.6 }, { head: "TYPE", w: 0.9 }, { head: "CONFIGURATION", w: 1.6 }, { head: "INPUT", w: 1.6 }],
      rows: doc.powerTypes.map((p) => [p.letter, U(p.type), U(p.config), U(p.input)]),
    });
  }

  // Wire legend: per wire type actually used, the cables seen carrying it.
  const cables = new Map<string, { symbol: string; signal: string; cables: Set<string> }>();
  const typeById = new Map(input.wireTypes.map((t) => [t.id, t]));
  let anyRun = false;
  for (const d of view.details) {
    for (const r of d.runs) {
      anyRun = true;
      for (const w of r.members) {
        if (!w.signal) continue;
        const cur = cables.get(w.signal.wireTypeId) || { symbol: w.signal.symbol, signal: w.signal.signal, cables: new Set<string>() };
        cur.cables.add(w.cable);
        cables.set(w.signal.wireTypeId, cur);
      }
      for (const id of r.run.signals || []) {
        const t = typeById.get(id);
        if (!t || !t.symbol) continue;
        const cur = cables.get(id) || { symbol: t.symbol, signal: t.signal, cables: new Set<string>() };
        if (!cur.cables.size) cur.cables.add(t.label);
        cables.set(id, cur);
      }
    }
  }
  if (cables.size) {
    const rows = [...cables.values()]
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .map((c) => [c.symbol, [...c.cables].sort().map((n) => (/^\(\d+\)/.test(n.trim()) ? U(n) : `(1) ${U(n)}`)).join(", "), U(c.signal)]);
    out.push({ key: "wire", title: "CONTROL WIRE LEGEND", columns: [{ head: "SYMBOL", w: 0.6 }, { head: "WIRE TYPE(S)", w: 2.2 }, { head: "SIGNAL", w: 1.2 }], rows });
  }

  if (anyRun) {
    out.push({
      key: "line",
      title: "LINE LEGEND",
      columns: [{ head: "", w: 1.2 }, { head: "", w: 2.8 }],
      rows: [
        [LINE_SOLID, "WIRE PULLS THROUGH CONDUIT"],
        [LINE_DASHED, "CABLE MANAGEMENT PROVIDED BY OTHERS"],
      ],
    });
  }

  const tagged = view.details.flatMap((d) => d.tags.map((t) => t.device));
  for (const dev of [...tagged].sort((a, b) => byNum(a.label, b.label))) {
    if (!dev.rack || !dev.rack.items.length) continue;
    out.push({
      key: "rack",
      title: `EQUIPMENT RACK CONTENTS — ${U(dev.label)}`,
      columns: [{ head: "ITEM", w: 2.6 }, { head: "QTY", w: 0.5 }],
      rows: dev.rack.items.map((i) => [U(i.desc), String(i.qty)]),
    });
  }

  const controls = tagged.filter((d) => d.typeKey === "dimming-power").sort((a, b) => byNum(a.label, b.label));
  if (controls.length) {
    out.push({
      key: "controls",
      title: "POWER CONTROLS",
      columns: [{ head: "ID", w: 0.8 }, { head: "DEVICE NAME", w: 2.0 }, { head: "CONTENTS", w: 1.2 }],
      rows: controls.map((d) => [U(d.label), U(d.model || d.desc), U(d.tag.contents)]),
    });
  }

  if (input.boxTypes.length) {
    out.push({
      key: "box",
      title: "CONDUIT BOX TYPES",
      columns: [{ head: "TYPE", w: 0.5 }, { head: "DESCRIPTION", w: 2.4 }],
      rows: input.boxTypes.map((b) => [U(b.code), U(b.description)]),
    });
  }
  return out;
}

/** Bray's AV1.5 box-type table — the seed for Settings → Box types. */
export const BRAY_BOX_TYPES: readonly CRBoxType[] = [
  { code: "AR", description: "As required for specified conduit" },
  { code: "A", description: "1-gang standard" },
  { code: "B", description: "1-gang deep" },
  { code: "C", description: "1-gang extra deep" },
  { code: "D", description: "1-gang weather proof (bell box)" },
  { code: "E", description: "2-gang standard" },
  { code: "F", description: "2-gang deep" },
  { code: "G", description: "2-gang extra deep" },
  { code: "H", description: "2-gang weather proof (bell box)" },
  { code: "I", description: "3-gang standard" },
  { code: "J", description: "3-gang deep" },
  { code: "K", description: "3-gang extra deep" },
  { code: "L", description: "4-gang standard" },
  { code: "M", description: "4-gang deep" },
  { code: "N", description: "4-gang extra deep" },
  { code: "O", description: "6x6x4 junction box" },
  { code: "P", description: "8x8x4 junction box" },
  { code: "Q", description: "10x10x4 junction box" },
  { code: "R", description: "12x12x4" },
  { code: "S", description: "14x14x4" },
  { code: "T", description: "24x24x4" },
  { code: "FB", description: "Floor box as specified" },
];

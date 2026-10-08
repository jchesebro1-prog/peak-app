"use client";

import { useEffect, useMemo, useState, type CSSProperties, type DragEvent } from "react";
import { ACCENT_INK, ACCENT_SOFT } from "@/app/(app)/estimator/est-ui";
import type { SpecSection } from "@/app/(app)/estimator/types";
import type { KeyProductLibrary } from "@/app/(app)/estimator/use-key-product-library";
import type { GroupBlock } from "@/lib/estimate-groups/groups";
import type { SystemIntro } from "@/lib/narrative/intros";
import { docGaps } from "@/lib/package-doc/gaps";
import {
  bomTree,
  DOC_NODE_MIME,
  docNodeDragData,
  docPresence,
  gapRows,
  introNodes,
  lineInDoc,
  lineLabel,
  notIncludedNodes,
  packageReadinessGaps,
  pageBreakNodes,
  payloadLibrarySku,
  priceTableNodes,
  systemInDoc,
  type DocNodePayload,
  type GapRow,
  type PackageDocApi,
} from "@/lib/package-doc/insert";
import type { PackageDoc, PDBlock } from "@/lib/package-doc/types";

/**
 * Estimator Phase 5 — the Build package editor's left pane:
 *  - Gaps: removed chips, products no longer in the BOM (click → scroll to
 *    the block), In-total systems the document never mentions (click →
 *    heading + empty intro paragraph + price line at the end), the itemized-appendix note, and the
 *    tab's package gaps. "No gaps." when there are none.
 *  - BOM: systems by group (Build order), each with the lines that can be
 *    featured. Drag a row into the document (application/x-peak-docnode), or
 *    press its + to insert at the cursor (the keyboard path); a system row
 *    also has + Price line (just its live price line, draggable too). ✓ = already in
 *    the document.
 *  - Library: saved system intros, Not included list, Price table, Page break.
 * The pane only talks to the editor through `api` (PackageDocApi).
 */

export type DocLeftPaneProps = {
  api: PackageDocApi | null;
  doc: PackageDoc;
  sections: SpecSection[];
  blocks: GroupBlock<SpecSection>[];
  intros: SystemIntro[];
  notIncluded: string;
  notIncludedDefault: string;
  library: KeyProductLibrary;
};

const NOT_INCLUDED_HINT = "Add a Not included list on the right first.";
const TITLE: CSSProperties = { fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".06em", textTransform: "uppercase", margin: "0 0 6px" };
const SUB: CSSProperties = { fontSize: 11, fontWeight: 600, color: "#5b616e", margin: "8px 0 3px" };
const SMALL: CSSProperties = { fontSize: 11.5, color: "#8c919c", lineHeight: 1.45 };
const ROW: CSSProperties = { display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", borderRadius: 6, fontSize: 12.5, color: "#3a3f4a", lineHeight: 1.35 };
const PLUS: CSSProperties = {
  flexShrink: 0,
  width: 22,
  height: 22,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "var(--font-ui)",
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1,
  color: ACCENT_INK,
  background: ACCENT_SOFT,
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  padding: 0,
};
const PRICE_LINE: CSSProperties = { ...PLUS, width: "auto", height: 22, padding: "0 7px", fontSize: 11 };
const LIB_BTN: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  textAlign: "left",
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 500,
  color: "#3a3f4a",
  background: "#f7f8fa",
  border: "1px solid #ececf0",
  borderRadius: 6,
  padding: "5px 8px",
  marginBottom: 4,
  cursor: "pointer",
};
const CHECK: CSSProperties = { flexShrink: 0, fontSize: 11.5, fontWeight: 700, color: "#1f8a5b" };
const ellipsis: CSSProperties = { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function Check({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <span style={CHECK} title="Already in the document">
      ✓<span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}> in the document</span>
    </span>
  );
}

export default function DocLeftPane({ api, doc, sections, blocks, intros, notIncluded, notIncludedDefault, library }: DocLeftPaneProps) {
  const [note, setNote] = useState("");
  const tree = useMemo(() => bomTree(blocks), [blocks]);
  const presence = useMemo(() => docPresence(doc), [doc]);
  const { rows: libRows, ensure } = library;
  const rows = useMemo(
    () => gapRows(docGaps(doc, sections), packageReadinessGaps(sections, true), (sku) => (Object.hasOwn(libRows, sku) ? libRows[sku].desc : null)),
    [doc, sections, libRows]
  );

  // Prefetch every featurable line's library paragraph, so a drop inserts at once.
  const skuKey = useMemo(() => {
    const out = new Set<string>();
    for (const g of tree) for (const s of g.systems) for (const it of s.lines) {
      const sku = payloadLibrarySku({ kind: "line", sectionId: s.sec.id, lineKey: String(it.id) }, sections);
      if (sku) out.add(sku);
    }
    return [...out].sort().join("\n");
  }, [tree, sections]);
  useEffect(() => {
    if (skuKey) void ensure(skuKey.split("\n"));
  }, [skuKey, ensure]);

  const ready = !!api;
  const notIncludedEmpty = notIncludedNodes(notIncluded, notIncludedDefault).length === 0;
  const done = (ok: boolean, what: string) => setNote(ok ? "" : `Couldn't insert ${what} — it may have left the BOM.`);
  /** A Library item: `empty` says why nothing went in when it builds no blocks. */
  const insertRow = (p: DocNodePayload, what: string) => {
    if (!api) return;
    void api.insertDocNode(p).then((ok) => done(ok, what), () => done(false, what));
  };
  const insertNodes = (nodes: PDBlock[], empty: string) => {
    if (!api) return;
    if (!nodes.length) return setNote(empty);
    setNote(api.insertBlocks(nodes) ? "" : "Couldn't insert it here — put the cursor in the document and try again.");
  };
  const onGap = (r: GapRow) => {
    if (!api || !r.action) return;
    if (r.action.kind === "scroll") api.scrollToProduct({ sectionId: r.action.sectionId, lineKey: r.action.lineKey, sku: r.action.sku });
    else void api.insertDocNode({ kind: "system", sectionId: r.action.sectionId, lineKey: "" }, "end");
  };
  const dragStart = (p: DocNodePayload) => (e: DragEvent<HTMLElement>) => {
    // Draggables nest (the + Price line span sits inside its system row): only
    // the element actually dragged writes the payload, and the event stops here
    // so an outer row can never overwrite it.
    if (e.target !== e.currentTarget) return;
    e.stopPropagation();
    e.dataTransfer.setData(DOC_NODE_MIME, docNodeDragData(p));
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <section aria-label="Gaps">
        <h3 style={TITLE}>Gaps</h3>
        {rows.length === 0 ? (
          <div style={SMALL}>No gaps.</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {rows.map((r) => {
              const color = r.tone === "info" ? "#5b616e" : "#8a6d1f";
              const bg = r.tone === "info" ? "#f3f4f6" : "#fbf3dd";
              const body = (
                <>
                  <span aria-hidden="true" style={{ flexShrink: 0, width: 6, height: 6, marginTop: 5, borderRadius: 999, background: r.tone === "info" ? "#9aa0ab" : "#c9962b" }} />
                  <span style={{ flex: 1, minWidth: 0 }}>{r.text}</span>
                </>
              );
              const box: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 7, fontSize: 12, lineHeight: 1.4, color, background: bg, borderRadius: 6, padding: "5px 8px" };
              return (
                <li key={r.key}>
                  {r.action ? (
                    <button
                      type="button"
                      disabled={!ready}
                      onClick={() => onGap(r)}
                      title={r.action.kind === "scroll" ? "Show it in the document" : "Add its heading and price at the end"}
                      style={{ ...box, width: "100%", textAlign: "left", border: "none", fontFamily: "var(--font-ui)", cursor: ready ? "pointer" : "default" }}
                    >
                      {body}
                    </button>
                  ) : (
                    <div style={box}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="BOM">
        <h3 style={TITLE}>BOM</h3>
        <div style={{ ...SMALL, marginBottom: 6 }}>Drag a system, its price line or a line into the document, or press + to add it at the cursor.</div>
        {tree.length === 0 && <div style={SMALL}>Add a system on the Build step.</div>}
        {tree.map((g) => (
          <div key={g.group?.id ?? "ungrouped"} style={{ marginBottom: 6 }}>
            {g.group && (
              <div style={SUB}>
                {g.group.name}
                {g.group.alternate ? " · Alternates" : ""}
              </div>
            )}
            {g.systems.map(({ sec, lines }) => {
              const name = (sec.name || "").trim() || "Untitled system";
              const sys: DocNodePayload = { kind: "system", sectionId: sec.id, lineKey: "" };
              const total: DocNodePayload = { kind: "systemTotal", sectionId: sec.id, lineKey: "" };
              return (
                <div key={sec.id} style={{ marginBottom: 4 }}>
                  <div draggable onDragStart={dragStart(sys)} style={{ ...ROW, fontWeight: 600, color: "#16181d", cursor: "grab" }} title="Drag into the document">
                    <span style={ellipsis}>
                      {name}
                      {sec.alternate === true ? <span style={{ fontWeight: 500, color: "#8c919c" }}> · Alternate</span> : null}
                    </span>
                    <Check on={systemInDoc(sec, presence)} />
                    <span draggable onDragStart={dragStart(total)} title="Drag into the document, or press to add at the cursor" style={{ display: "inline-flex", cursor: "grab" }}>
                      <button type="button" aria-label={`Insert price line for ${name}`} disabled={!ready} style={PRICE_LINE} onClick={() => insertRow(total, `${name} price line`)}>
                        + Price line
                      </button>
                    </span>
                    <button type="button" aria-label={`Insert ${name}`} disabled={!ready} style={PLUS} onClick={() => insertRow(sys, name)}>
                      +
                    </button>
                  </div>
                  {lines.map((it) => {
                    const label = lineLabel(it);
                    const p: DocNodePayload = { kind: "line", sectionId: sec.id, lineKey: String(it.id) };
                    return (
                      <div key={it.id} draggable onDragStart={dragStart(p)} style={{ ...ROW, paddingLeft: 16, cursor: "grab" }} title="Drag into the document">
                        <span style={ellipsis}>{label}</span>
                        <Check on={lineInDoc(sec.id, it.id, presence)} />
                        <button type="button" aria-label={`Insert ${label}`} disabled={!ready} style={PLUS} onClick={() => insertRow(p, label)}>
                          +
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </section>

      <section aria-label="Library">
        <h3 style={TITLE}>Library</h3>
        <div style={SUB}>System intros</div>
        {intros.length === 0 ? (
          <div style={{ ...SMALL, marginBottom: 6 }}>No saved intros yet.</div>
        ) : (
          intros.map((x) => (
            <button key={x.id} type="button" aria-label={`Insert ${x.title}`} disabled={!ready} style={LIB_BTN} onClick={() => insertNodes(introNodes(x.text), `"${x.title}" has no text.`)}>
              <span aria-hidden="true" style={{ color: ACCENT_INK, fontWeight: 600 }}>+</span>
              <span style={ellipsis}>{x.title}</span>
            </button>
          ))
        )}
        <div style={SUB}>Blocks</div>
        <button
          type="button"
          disabled={!ready || notIncludedEmpty}
          title={notIncludedEmpty ? NOT_INCLUDED_HINT : undefined}
          aria-describedby={notIncludedEmpty ? "pd-ni-hint" : undefined}
          style={{ ...LIB_BTN, opacity: notIncludedEmpty ? 0.55 : 1, cursor: notIncludedEmpty ? "not-allowed" : "pointer" }}
          onClick={() => insertNodes(notIncludedNodes(notIncluded, notIncludedDefault), NOT_INCLUDED_HINT)}
        >
          <span aria-hidden="true" style={{ color: ACCENT_INK, fontWeight: 600 }}>+</span>
          Not included list
        </button>
        {notIncludedEmpty && (
          <div id="pd-ni-hint" style={{ ...SMALL, marginBottom: 4 }}>
            {NOT_INCLUDED_HINT}
          </div>
        )}
        <button type="button" disabled={!ready} style={LIB_BTN} onClick={() => insertNodes(priceTableNodes(), "")}>
          <span aria-hidden="true" style={{ color: ACCENT_INK, fontWeight: 600 }}>+</span>
          Price table
        </button>
        <button type="button" disabled={!ready} style={LIB_BTN} onClick={() => insertNodes(pageBreakNodes(), "")}>
          <span aria-hidden="true" style={{ color: ACCENT_INK, fontWeight: 600 }}>+</span>
          Page break
        </button>
      </section>

      <div role="status" aria-live="polite" style={{ ...SMALL, color: "#b4543a", minHeight: 1 }}>
        {note}
      </div>
    </div>
  );
}

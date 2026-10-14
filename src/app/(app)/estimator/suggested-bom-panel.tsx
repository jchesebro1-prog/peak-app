"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { AddedSystemState } from "@/lib/assist/features/suggestion";
import { suggestionPanelVM, type EstimateSuggestionView, type SuggestionParts } from "@/lib/assist/features/suggestion-panel";
import type { SpecSection } from "./types";
import { ACCENT_INK, ACCENT_SOFT } from "./est-ui";

/**
 * Estimate suggestion (spec 2026-10-13 §2) — the Build step's Suggested BOM
 * column: where the suggestion came from (with a link back), the estimator
 * notes, and each suggested system with its lines (qty × part · why ·
 * ✓ added / needs a part). "+ Add system" builds the whole system; "+" adds
 * one line to the chosen system. Nothing here prices or stores — the hook's
 * add paths do, through the Estimator's own catalog pricing. Collapsible to a
 * 36px tab like the systems rail.
 */
export function SuggestedBomPanel({
  view,
  parts,
  added,
  sections,
  open,
  onToggle,
  targetFor,
  onAddSystem,
  onAddLine,
}: {
  view: EstimateSuggestionView;
  parts: SuggestionParts;
  added: Readonly<Record<string, AddedSystemState>>;
  sections: ReadonlyArray<Pick<SpecSection, "id" | "name">>;
  open: boolean;
  onToggle: () => void;
  targetFor: (systemKey: string) => string;
  onAddSystem: (systemKey: string) => void;
  onAddLine: (systemKey: string, lineKey: string, targetSecId: string) => void;
}) {
  const systems = useMemo(() => suggestionPanelVM(view, added, parts), [view, added, parts]);
  /** A target picked in a system's select (else the hook's default). */
  const [picked, setPicked] = useState<Record<string, string>>({});
  const lineCount = view.systems.reduce((n, s) => n + s.lines.length, 0);

  if (!open) {
    return (
      <div className="est-suggest est-suggest-collapsed" style={{ width: 36, flexShrink: 0, minHeight: 0, display: "flex", flexDirection: "column", background: "#fff", borderLeft: "1px solid #ececf0" }}>
        <button
          type="button"
          className="est-side-tab"
          onClick={onToggle}
          aria-expanded={false}
          title="Show the suggested BOM"
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", gap: 10, padding: "12px 0", background: "transparent", border: "none", color: "#9aa0ab", cursor: "pointer", fontFamily: "var(--font-ui)" }}
        >
          <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>‹</span>
          <span className="est-side-vlabel" style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", writingMode: "vertical-rl", whiteSpace: "nowrap" }}>
            Suggested BOM
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#6b7079" }}>{lineCount}</span>
        </button>
      </div>
    );
  }

  return (
    <aside
      className="est-suggest est-scroll"
      aria-label="Suggested BOM"
      style={{ width: 320, flexShrink: 0, minHeight: 0, overflowY: "auto", background: "#fff", borderLeft: "1px solid #ececf0", padding: "14px 14px 40px" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span style={HEAD}>Suggested BOM</span>
        <button type="button" onClick={onToggle} aria-expanded={true} title="Hide the suggested BOM" style={HIDE_BTN}>
          Hide ›
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "#3a3f4a", lineHeight: 1.4 }}>
        {view.sourceHref ? (
          <a href={view.sourceHref} target="_blank" rel="noopener" style={{ color: ACCENT_INK, textDecoration: "underline" }}>
            {view.sourceLine}
          </a>
        ) : (
          view.sourceLine
        )}
      </div>
      <div style={{ fontSize: 11, color: "#6b7079", margin: "4px 0 10px", lineHeight: 1.35 }}>
        A suggestion — check every line. Added lines price at today&apos;s catalog and this estimate&apos;s tier.
      </div>
      {view.notes && (
        <p style={{ margin: "0 0 12px", padding: "8px 10px", background: "#f7f8fa", borderRadius: 8, fontSize: 12, color: "#3a3f4a", whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{view.notes}</p>
      )}

      {systems.map((sys) => {
        const target = picked[sys.key] && sections.some((s) => s.id === picked[sys.key]) ? picked[sys.key] : targetFor(sys.key);
        return (
          <section key={sys.key} style={{ margin: "0 0 14px", border: "1px solid #ececf0", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", background: "#f7f8fa" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#16181d", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sys.name}</div>
                <div style={{ fontSize: 10.5, color: sys.all ? "#1f8a5b" : "#6b7079", fontFamily: "var(--font-mono)" }}>
                  {sys.all ? "✓ all added" : `${sys.added} of ${sys.total} added`}
                </div>
              </div>
              <button type="button" className="est-suggest-add" onClick={() => {
                  // The new system becomes this suggestion system's default target.
                  setPicked((m) => {
                    const rest = { ...m };
                    delete rest[sys.key];
                    return rest;
                  });
                  onAddSystem(sys.key);
                }} title={`Add "${sys.name}" as a new system`} style={ADD_SYS_BTN}>
                + Add system
              </button>
            </div>
            {sections.length > 0 && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 0", fontSize: 11, color: "#6b7079" }}>
                <span style={{ flexShrink: 0 }}>Lines go to</span>
                <select
                  value={target}
                  onChange={(e) => setPicked((m) => ({ ...m, [sys.key]: e.target.value }))}
                  aria-label={`System the "${sys.name}" lines go to`}
                  style={{ flex: 1, minWidth: 0, fontSize: 11.5, padding: "2px 4px", border: "1px solid #e4e7ec", borderRadius: 6, background: "#fff", fontFamily: "var(--font-ui)" }}
                >
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name || "Untitled system"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <ul style={{ listStyle: "none", margin: 0, padding: "4px 0" }}>
              {sys.lines.map((l) => (
                <li key={l.key} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 10px" }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.35 }}>
                    <div style={{ color: "#16181d" }}>
                      <span style={{ fontFamily: "var(--font-mono)", color: "#5b616e" }}>{l.qty} ×</span> {l.desc}
                    </div>
                    {l.reason && <div style={{ color: "#6b7079", fontSize: 11 }}>{l.reason}</div>}
                    <div style={{ fontSize: 10.5, marginTop: 1 }}>
                      {l.added ? (
                        <span style={{ color: "#1f8a5b", fontWeight: 600 }}>✓ added</span>
                      ) : l.needsPart ? (
                        <span style={{ color: "#9a6b00", fontWeight: 600 }}>needs a part</span>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="est-suggest-add"
                    disabled={!target}
                    onClick={() => target && onAddLine(sys.key, l.key, target)}
                    title={target ? "Add this line to the chosen system" : "Add a system first"}
                    aria-label={`Add ${l.qty} × ${l.desc}`}
                    style={{ ...LINE_BTN, opacity: target ? 1 : 0.4, cursor: target ? "pointer" : "default" }}
                  >
                    +
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {view.truncated > 0 && (
        <div style={{ fontSize: 11.5, color: "#6b7079" }}>
          {view.truncated} more line{view.truncated === 1 ? "" : "s"} not shown
        </div>
      )}
    </aside>
  );
}

const HEAD: CSSProperties = { fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase" };
const HIDE_BTN: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  background: "transparent",
  border: "1px solid #e4e7ec",
  borderRadius: 6,
  padding: "3px 7px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const ADD_SYS_BTN: CSSProperties = {
  flexShrink: 0,
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 600,
  color: ACCENT_INK,
  background: ACCENT_SOFT,
  border: "none",
  borderRadius: 6,
  padding: "4px 8px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const LINE_BTN: CSSProperties = {
  flexShrink: 0,
  width: 24,
  height: 24,
  fontSize: 15,
  lineHeight: 1,
  fontWeight: 600,
  color: ACCENT_INK,
  background: ACCENT_SOFT,
  border: "none",
  borderRadius: 6,
  fontFamily: "var(--font-ui)",
};

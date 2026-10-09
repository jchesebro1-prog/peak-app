"use client";

import { ConfirmButton } from "@/components/confirm-button";
import { removeSheetAction } from "../actions";
import type { GridEditor } from "../use-grid-editor";
import Menu from "./menu";

/**
 * Sheet tabs above the plan (#299) — one tab per sheet (was the header's
 * sheet <select>), a `+` tab that uploads a new, separate sheet (was
 * "+ Additional sheet"), a ⋯ menu per tab holding Delete sheet, and the
 * PDF page ‹ n/N › at the right end. Under the plan, the Plan view /
 * Spreadsheet view tabs.
 */

const TAB: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  height: 28,
  padding: "0 4px 0 11px",
  borderRadius: "7px 7px 0 0",
  fontSize: 12,
  fontWeight: 600,
  fontFamily: "inherit",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
};

const NAV_BTN: React.CSSProperties = {
  height: 24,
  minWidth: 24,
  border: "1px solid #4d5057",
  background: "#55585f",
  color: "#e6e8ec",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "inherit",
  cursor: "pointer",
};

export default function SheetTabs({ ed }: { ed: GridEditor }) {
  const { project, sheets, sheet, switchSheet, busy, fileRef, upload, isPdf, page, pages, goToPage, noteAction, onStructuralChange, openAdjust, adjustAvailability } = ed;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 3,
        padding: "5px 8px 0",
        background: "#55585f",
        flex: "0 0 auto",
        minWidth: 0,
      }}
    >
      <div role="tablist" aria-label="Plan sheets" style={{ display: "flex", alignItems: "flex-end", flexWrap: "wrap", gap: 3, minWidth: 0 }}>
        {sheets.map((s) => {
          const on = s.id === sheet?.id;
          const avail = adjustAvailability(s);
          return (
            <div
              key={s.id}
              style={{
                ...TAB,
                background: on ? "#6d7076" : "#62656b",
                color: on ? "#fff" : "#d3d6dc",
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => !on && switchSheet(s.id)}
                title={s.name}
                style={{
                  border: "none",
                  background: "none",
                  color: "inherit",
                  font: "inherit",
                  padding: 0,
                  cursor: on ? "default" : "pointer",
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {s.name}
              </button>
              <Menu
                label="⋯"
                title={`${s.name} — sheet actions`}
                chevron={false}
                items={avail.hidden ? [] : [{ label: "Crop & rotate…", onSelect: () => openAdjust(s.id), disabled: avail.disabled, title: avail.title }]}
                triggerStyle={{ height: 22, padding: "0 5px", border: "none", background: "transparent", color: "inherit", fontSize: 13 }}
              >
                <ConfirmButton
                  className="pk-btn-danger"
                  label="Delete sheet"
                  confirmLabel="Confirm"
                  style={{ fontSize: 11.5, padding: "6px 10px" }}
                  title="Deletes this sheet from the design, along with any Spaces drawn on it (saved as a revision first); refused while it still has devices or wires on it."
                  onConfirm={async () => {
                    const r = await removeSheetAction(project.id, s.id);
                    if (!r.ok) throw new Error(r.error);
                    const n = r.spacesRemoved;
                    noteAction(
                      n > 0
                        ? `Deleted sheet ${s.name} (and ${n} space${n === 1 ? "" : "s"} — saved as a revision)`
                        : `Deleted sheet ${s.name}`
                    );
                    onStructuralChange();
                  }}
                />
              </Menu>
            </div>
          );
        })}
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          aria-label={sheets.length > 0 ? "+ Additional sheet" : "+ Plan sheet"}
          title={
            sheets.length > 0
              ? "Uploads a real plan as a NEW, separate sheet — the sheet(s) already here, and everything placed on them, are untouched — not undoable; use Revisions"
              : "Upload a plan sheet (PDF or image) — not undoable; use Revisions"
          }
          style={{ ...TAB, padding: "0 11px", border: "none", background: "transparent", color: "#d3d6dc", cursor: "pointer", fontSize: 15 }}
        >
          +
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) upload(f);
        }}
      />
      <span style={{ flex: 1 }} />
      {isPdf && pages > 1 && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, paddingBottom: 3, flex: "0 0 auto" }}>
          <button type="button" style={NAV_BTN} aria-label="Previous page" disabled={page <= 1} onClick={() => goToPage(page - 1)}>‹</button>
          <span style={{ fontSize: 12, color: "#e6e8ec" }}>{page} / {pages}</span>
          <button type="button" style={NAV_BTN} aria-label="Next page" disabled={page >= pages} onClick={() => goToPage(page + 1)}>›</button>
        </div>
      )}
    </div>
  );
}

/** Plan view / Spreadsheet view, under the plan (#299). */
export function ViewTabs({ ed }: { ed: GridEditor }) {
  const { view, setView } = ed;
  const tab = (v: "plan" | "sheet", label: string) => {
    const on = view === v;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={on}
        onClick={() => setView(v)}
        style={{
          ...TAB,
          padding: "0 12px",
          borderRadius: "0 0 7px 7px",
          border: "none",
          background: on ? "#6d7076" : "transparent",
          color: on ? "#fff" : "#d3d6dc",
          cursor: on ? "default" : "pointer",
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div role="tablist" aria-label="View" style={{ display: "flex", gap: 3, padding: "0 8px 4px", background: "#55585f", flex: "0 0 auto" }}>
      {tab("plan", "Plan view")}
      {tab("sheet", "Spreadsheet view")}
    </div>
  );
}

"use client";

import { useState } from "react";
import type { GridSpace } from "@/lib/stores/grid-projects";
import type { RollupSlice, SpaceRollup } from "@/lib/design/grid-bom";
import { scopeColor } from "@/lib/design/grid-scopes";
import { removeSpaceAction, renameSpaceAction } from "./actions";

/**
 * Spaces sidebar panel (D109) — list the active page's rooms with their
 * device rollups, arm the draw tool, rename/delete the selected space.
 * Inline entry everywhere: window.prompt/confirm are unavailable here.
 */

const BTN: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
};

const INPUT: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  borderRadius: 7,
  padding: "5px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
  width: "100%",
};

function moneyFmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/**
 * Scope / category breakdown for one space (punch #48). Jeff: "those
 * categories should track through with the spaces as well" - before this a
 * space knew only a flat count and value, so the answer to "what's the
 * lighting in the booth?" was to count markers by eye.
 *
 * Categories deliberately do NOT sum to the space total: they are opt-in
 * labels, and most placements carry none.
 */
function Breakdown({
  title,
  slices,
  color,
}: {
  title: string;
  slices: RollupSlice[];
  color?: (key: string) => string;
}) {
  if (slices.length === 0) return null;
  return (
    <div style={{ marginTop: 5, display: "grid", gap: 2 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#b4b9c2" }}>
        {title}
      </div>
      {slices.map((s) => (
        <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#8c919c" }}>
          <span
            aria-hidden
            style={{
              width: 7, height: 7, borderRadius: 2, flex: "0 0 auto",
              background: color ? color(s.key) : "#c4c9d2",
            }}
          />
          <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {s.key}
          </span>
          <span>{s.count} · {moneyFmt(s.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function SpacesPanel({
  projectId,
  pageSpaces,
  rollups,
  drawing,
  selectedSpaceId,
  busy,
  onStartDraw,
  onCancelDraw,
  onSelect,
  onChanged,
  onError,
}: {
  projectId: string;
  /** Spaces on the active sheet+page, project order. */
  pageSpaces: GridSpace[];
  /** Whole-project rollups (all sheets), from bomBySpace. */
  rollups: SpaceRollup[];
  drawing: boolean;
  selectedSpaceId: string | null;
  busy: boolean;
  onStartDraw: () => void;
  onCancelDraw: () => void;
  onSelect: (id: string | null) => void;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [armDelete, setArmDelete] = useState(false);
  const rollupById = new Map(rollups.map((r) => [r.spaceId, r]));
  const selected = pageSpaces.find((s) => s.id === selectedSpaceId) || null;
  const offPageRollups = rollups.filter(
    (r) => r.spaceId !== null && !pageSpaces.some((s) => s.id === r.spaceId)
  );
  const unassigned = rollupById.get(null);

  return (
    <div style={{ background: "#fff", border: "1px solid #edeff3", borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 7 }}>
        Spaces
      </div>
      <button
        style={{
          ...BTN,
          width: "100%",
          background: drawing ? "#16181d" : "#fff",
          color: drawing ? "#fff" : "#3d424e",
          borderColor: drawing ? "#16181d" : "#dfe2e8",
        }}
        disabled={busy}
        onClick={drawing ? onCancelDraw : onStartDraw}
      >
        {drawing ? "Click corners · click the first corner to close" : "Draw a space"}
      </button>
      {pageSpaces.length === 0 && !drawing && (
        <div style={{ fontSize: 11, color: "#8c919c", marginTop: 6 }}>
          Outline rooms — the BOM rolls up per space.
        </div>
      )}

      {pageSpaces.length > 0 && (
        <div style={{ marginTop: 9, display: "grid", gap: 3 }}>
          {pageSpaces.map((s) => {
            const r = rollupById.get(s.id);
            const on = s.id === selectedSpaceId;
            return (
              <div key={s.id}>
                <button
                  onClick={() => { onSelect(on ? null : s.id); setRenameDraft(null); setArmDelete(false); }}
                  style={{
                    ...BTN,
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    fontWeight: 500,
                    padding: "5px 8px",
                    background: on ? "#f4f0e9" : "#fff",
                    borderColor: on ? "#d9cbb2" : "#dfe2e8",
                  }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flex: "0 0 auto" }} />
                  <span style={{ flex: 1, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.name}
                  </span>
                  <span style={{ fontSize: 11, color: "#8c919c" }}>
                    {r ? `${r.count} · ${moneyFmt(r.value)}` : "empty"}
                  </span>
                </button>
                {/* The scope/category split rides UNDER the row and only for
                    the selected space - every space expanded at once is the
                    "busy" Jeff was complaining about. */}
                {on && r && (
                  <div style={{ padding: "2px 8px 4px" }}>
                    <Breakdown title="By scope" slices={r.byScope} color={scopeColor} />
                    <Breakdown title="Your categories" slices={r.byCategory} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <div style={{ marginTop: 9, borderTop: "1px solid #edeff3", paddingTop: 9 }}>
          {renameDraft === null ? (
            <div style={{ display: "flex", gap: 5 }}>
              <button style={{ ...BTN, flex: 1, padding: "4px 8px", fontSize: 11 }} onClick={() => setRenameDraft(selected.name)}>
                Rename
              </button>
              {!armDelete ? (
                <button style={{ ...BTN, flex: 1, padding: "4px 8px", fontSize: 11, color: "#a0442b" }} onClick={() => setArmDelete(true)}>
                  Delete
                </button>
              ) : (
                <button
                  style={{ ...BTN, flex: 1, padding: "4px 8px", fontSize: 11, background: "#a0442b", color: "#fff", borderColor: "#a0442b" }}
                  disabled={busy}
                  onClick={async () => {
                    const r = await removeSpaceAction(projectId, selected.id);
                    setArmDelete(false);
                    onSelect(null);
                    if (!r.ok) onError(r.error);
                    else onChanged();
                  }}
                >
                  Really delete
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 5 }}>
              <input
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Escape") setRenameDraft(null);
                  if (e.key === "Enter" && renameDraft.trim()) {
                    const r = await renameSpaceAction(projectId, selected.id, renameDraft);
                    setRenameDraft(null);
                    if (!r.ok) onError(r.error);
                    else onChanged();
                  }
                }}
                style={INPUT}
                autoFocus
              />
              <button
                style={{ ...BTN, padding: "4px 9px", fontSize: 11 }}
                disabled={busy || !renameDraft.trim()}
                onClick={async () => {
                  const r = await renameSpaceAction(projectId, selected.id, renameDraft);
                  setRenameDraft(null);
                  if (!r.ok) onError(r.error);
                  else onChanged();
                }}
              >
                Save
              </button>
            </div>
          )}
          <div style={{ fontSize: 10.5, color: "#9aa0ab", marginTop: 5 }}>
            Devices inside the outline belong to it automatically — nested
            spaces win by smallest.
          </div>
        </div>
      )}

      {(offPageRollups.length > 0 || unassigned) && (
        <div style={{ marginTop: 9, borderTop: "1px solid #edeff3", paddingTop: 8, display: "grid", gap: 3 }}>
          {offPageRollups.map((r) => (
            <div key={r.spaceId} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#8c919c" }}>
              <span>{r.name} (other sheet)</span>
              <span>{r.count} · {moneyFmt(r.value)}</span>
            </div>
          ))}
          {unassigned && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#8c919c" }}>
              <span>Unassigned</span>
              <span>{unassigned.count} · {moneyFmt(unassigned.value)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

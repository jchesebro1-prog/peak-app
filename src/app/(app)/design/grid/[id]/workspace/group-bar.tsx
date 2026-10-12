"use client";

import type { GridEditor } from "../use-grid-editor";

/**
 * Grid notes #4 — the two equipment-group lines over the plan (the riser
 * prompt's idiom: one line, never a modal):
 * - "Placing inside RK-1": every Product Library pick goes into the holder
 *   until Done / Esc / another tool.
 * - "RK-1 holds 6 devices": a Delete of a holder whose devices weren't picked
 *   with it asks EVERY time — delete them too, or keep them on the plan
 *   beside it. Cancel (or changing the selection) drops the question.
 */

const BTN: React.CSSProperties = {
  border: "1px solid #d9c7a0",
  background: "#fff",
  borderRadius: 6,
  padding: "1px 8px",
  fontFamily: "inherit",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#6b4e16",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export default function GroupBar({ ed }: { ed: GridEditor }) {
  const { placeInsideHolder, stopPlaceInside, holderLabel, holderCounts, deleteAsk, answerDeleteAsk, placementsById, busy } = ed;

  if (deleteAsk) {
    const holders = deleteAsk.ids.flatMap((id) => placementsById.get(id) ?? []).filter((pl) => (holderCounts.get(pl.id) || 0) > 0);
    const who = holders.length === 1 ? holderLabel(holders[0]) : `${deleteAsk.holders} of these`;
    const n = deleteAsk.inside;
    const devices = `${n} device${n === 1 ? "" : "s"}`;
    return (
      <div
        role="alertdialog"
        aria-label={`${who} holds ${devices}`}
        data-testid="group-delete-ask"
        data-no-nudge
        style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "4px 10px", background: "#fbf3e4", borderBottom: "1px solid #ecdcb8", fontSize: 11.5, color: "#6b4e16" }}
      >
        <span style={{ flex: "1 1 260px", minWidth: 0, lineHeight: 1.45 }}>
          {`${who} ${holders.length === 1 ? "holds" : "hold"} ${devices}. Delete them too?`}
        </span>
        <button type="button" disabled={busy} onClick={() => void answerDeleteAsk("delete")} style={{ ...BTN, background: "#a0442b", borderColor: "#a0442b", color: "#fff" }}>
          {`Delete the ${devices} inside too`}
        </button>
        <button type="button" disabled={busy} onClick={() => void answerDeleteAsk("keep")} style={BTN}>
          Keep them on the plan beside it
        </button>
        <button type="button" disabled={busy} onClick={() => void answerDeleteAsk(null)} style={{ ...BTN, border: "none", background: "none" }}>
          Cancel
        </button>
      </div>
    );
  }

  if (!placeInsideHolder) return null;
  const n = holderCounts.get(placeInsideHolder.id) || 0;
  return (
    <div
      role="status"
      data-testid="place-inside-bar"
      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "4px 10px", background: "#eef6ef", borderBottom: "1px solid #cfe4d3", fontSize: 11.5, color: "#245c34" }}
    >
      <span style={{ flex: "1 1 300px", minWidth: 0, lineHeight: 1.45 }}>
        <strong>{`Placing inside ${holderLabel(placeInsideHolder)}`}</strong>
        {` (holds ${n}) — click parts in the Product Library; each click adds one. Esc stops.`}
      </span>
      <button type="button" onClick={stopPlaceInside} style={{ ...BTN, borderColor: "#b9d8c0", color: "#245c34" }}>
        Done
      </button>
    </div>
  );
}

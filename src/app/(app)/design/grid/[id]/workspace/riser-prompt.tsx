"use client";

import { useTransition } from "react";
import { acceptSuggestionsAction } from "../conduit-riser/actions";
import type { GridEditor } from "../use-grid-editor";

/**
 * #321 — "Add ER-01 → CRO-04 to the lighting control riser?" One line over
 * the plan right after a wire is drawn between two devices the riser would
 * show. Add puts the pair on the riser (or, when the pair already has a run,
 * joins this wire to it); Later hides it. When the pair's wire won't be
 * priced, the line says it will be listed as by others. It never blocks drawing: the next
 * canvas click, Escape or a newer wire's prompt replaces it. A failed Add
 * keeps the prompt and reports in the status bar.
 */

const BTN: React.CSSProperties = {
  border: "1px solid #bcd3e8",
  background: "#fff",
  borderRadius: 6,
  padding: "1px 8px",
  fontFamily: "inherit",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#25507a",
  cursor: "pointer",
};

export default function RiserPrompt({ ed }: { ed: GridEditor }) {
  const { riserPrompt, hideRiserPrompt, project, router, noteAction, activeOptionId } = ed;
  const [pending, start] = useTransition();
  if (!riserPrompt || riserPrompt.optionId !== activeOptionId) return null;

  const add = () =>
    start(async () => {
      let r: Awaited<ReturnType<typeof acceptSuggestionsAction>>;
      try {
        r = await acceptSuggestionsAction(project.id, riserPrompt.optionId, [riserPrompt.key]);
      } catch {
        r = { ok: false, error: "That didn't save — check your connection and try again." };
      }
      if (!r.ok) {
        noteAction(r.error);
        return;
      }
      // Nothing accepted: the pair went on the riser elsewhere (another tab,
      // the riser page) — say so instead of claiming an add.
      noteAction(r.accepted > 0 ? "Added to the riser" : "Already on the riser");
      hideRiserPrompt();
      router.refresh();
    });

  return (
    <div
      data-testid="riser-prompt"
      role="status"
      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "4px 10px", background: "#edf4fb", borderBottom: "1px solid #cfe0f0", fontSize: 11.5, color: "#25507a" }}
    >
      <span style={{ flex: "1 1 300px", minWidth: 0, lineHeight: 1.45 }}>
        {riserPrompt.joins
          ? `${riserPrompt.label} joins the existing run — add this wire?`
          : `Add ${riserPrompt.label} to the lighting control riser?`}
        {riserPrompt.byOthers ? " — its wire will be listed as by others" : ""}
      </span>
      <button type="button" disabled={pending} onClick={add} style={BTN}>
        {pending ? "Adding…" : "Add"}
      </button>
      <button type="button" disabled={pending} onClick={hideRiserPrompt} style={{ ...BTN, border: "none", background: "none" }}>
        Later
      </button>
    </div>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveWidget, removeWidget, type Surface } from "@/lib/dashboard/registry";
import { saveLayoutAction } from "../dashboard-actions";

const BTN: React.CSSProperties = {
  border: "1px solid #dfe2e8", background: "#fff", borderRadius: 7, padding: "3px 9px",
  fontSize: 11.5, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit",
};

/** #43 — per-widget controls shown only in ?customize=1. Sends the whole
 *  next list; the server normalizes. */
export default function FrameControls({
  surface, ids, id, title, index,
}: { surface: Surface; ids: string[]; id: string; title: string; index: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const save = (next: string[]) =>
    start(async () => {
      await saveLayoutAction(surface, next);
      router.refresh();
    });
  return (
    <div className="pk-dash-controls">
      <span style={{ flex: 1, fontWeight: 600, color: "#3d424e" }}>{title}</span>
      <button type="button" style={BTN} disabled={pending || index === 0} onClick={() => save(moveWidget(ids, id, -1))}>Up</button>
      <button type="button" style={BTN} disabled={pending || index === ids.length - 1} onClick={() => save(moveWidget(ids, id, 1))}>Down</button>
      <button type="button" style={{ ...BTN, color: "#b4543a" }} disabled={pending} onClick={() => save(removeWidget(ids, id))}>Remove</button>
    </div>
  );
}

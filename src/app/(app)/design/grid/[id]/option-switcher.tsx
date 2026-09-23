"use client";

import { useState } from "react";
import type { GridOption } from "@/lib/stores/grid-projects";
import { addOptionAction, removeOptionAction, renameOptionAction } from "./actions";

/**
 * Option switcher (Spec 1) — segmented control over a project's options
 * (Good / Better / Best, or whatever the designer named them) with add /
 * rename / delete. The ACTIVE option lives in the URL (?option=) so the
 * editor, riser, schedule and quote minting all agree; switching is a soft
 * navigation the parent performs via `onSwitch`.
 */

const BTN: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  background: "#fff", borderRadius: 7, padding: "5px 10px",
  fontSize: 12, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit",
};
const INPUT: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8", borderRadius: 7,
  padding: "5px 8px", fontSize: 12, fontFamily: "inherit", background: "#fff", color: "#16181d", width: 150,
};

export default function OptionSwitcher({
  projectId,
  options,
  activeId,
  counts,
  busy,
  onSwitch,
  onChanged,
  onError,
}: {
  projectId: string;
  options: GridOption[];
  activeId: string;
  /** placed device count per option id (for the segment badge). */
  counts: Map<string, number>;
  busy: boolean;
  onSwitch: (optionId: string) => void;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"idle" | "add" | "rename" | "delete">("idle");
  const [name, setName] = useState("");
  const [copy, setCopy] = useState(true);
  const [pending, setPending] = useState(false);
  const active = options.find((o) => o.id === activeId) || options[0];
  const activeCount = counts.get(active.id) || 0;

  const run = async (fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, after?: (r: Record<string, unknown>) => void) => {
    setPending(true);
    const r = await fn();
    setPending(false);
    if (!r.ok) { onError(r.error || "Something went wrong."); return; }
    setMode("idle");
    setName("");
    after?.(r);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }} title="Design options — each has its own devices, wire runs, BOM and quote; sheets and spaces are shared">
      <div style={{ display: "inline-flex", border: "1px solid #dfe2e8", borderRadius: 7, overflow: "hidden" }}>
        {options.map((o) => {
          const on = o.id === active.id;
          return (
            <button
              key={o.id}
              onClick={() => onSwitch(o.id)}
              disabled={busy || pending}
              style={{
                border: "none", borderRight: "1px solid #eceef2", padding: "5px 10px",
                background: on ? "#16181d" : "#fff", color: on ? "#fff" : "#3d424e",
                fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              {o.name}
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, opacity: 0.7 }}>{counts.get(o.id) || 0}</span>
            </button>
          );
        })}
      </div>

      {mode === "idle" && (
        <>
          <button style={BTN} disabled={busy || pending} onClick={() => { setMode("add"); setName(""); setCopy(activeCount > 0); }}>+ Option</button>
          <button style={BTN} disabled={busy || pending} onClick={() => { setMode("rename"); setName(active.name); }}>Rename</button>
          <button
            style={{ ...BTN, color: options.length <= 1 ? "#b6bac2" : "#a0442b" }}
            disabled={busy || pending || options.length <= 1}
            title={options.length <= 1 ? "A design keeps at least one option" : `Remove ${active.name} and everything placed in it`}
            onClick={() => setMode("delete")}
          >
            Delete
          </button>
        </>
      )}

      {mode === "add" && (
        <>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Option name (e.g. Better)" style={INPUT}
            onKeyDown={(e) => { if (e.key === "Escape") setMode("idle"); }} />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#3d424e" }}>
            <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} /> Copy {active.name}
          </label>
          <button style={{ ...BTN, background: "#16181d", color: "#fff", borderColor: "#16181d" }} disabled={pending || !name.trim()}
            onClick={() => run(() => addOptionAction(projectId, { name, copyFromOptionId: copy ? active.id : null }), (r) => { onChanged(); onSwitch(String(r.optionId)); })}>
            {pending ? "Adding…" : "Add"}
          </button>
          <button style={BTN} disabled={pending} onClick={() => setMode("idle")}>Cancel</button>
        </>
      )}

      {mode === "rename" && (
        <>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} style={INPUT}
            onKeyDown={(e) => { if (e.key === "Escape") setMode("idle"); }} />
          <button style={{ ...BTN, background: "#16181d", color: "#fff", borderColor: "#16181d" }} disabled={pending || !name.trim()}
            onClick={() => run(() => renameOptionAction(projectId, active.id, name), () => onChanged())}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button style={BTN} disabled={pending} onClick={() => setMode("idle")}>Cancel</button>
        </>
      )}

      {mode === "delete" && (
        <>
          <span style={{ fontSize: 11.5, color: "#5b616e" }}>
            Removes {activeCount} device{activeCount === 1 ? "" : "s"} and their wire runs from <strong>{active.name}</strong>. Sheets, spaces and other options are untouched.
          </span>
          <button style={{ ...BTN, background: "#a0442b", color: "#fff", borderColor: "#a0442b" }} disabled={pending}
            onClick={() => run(() => removeOptionAction(projectId, active.id), () => { onChanged(); onSwitch(options.find((o) => o.id !== active.id)!.id); })}>
            {pending ? "Removing…" : `Delete ${active.name}`}
          </button>
          <button style={BTN} disabled={pending} onClick={() => setMode("idle")}>Cancel</button>
        </>
      )}
    </div>
  );
}

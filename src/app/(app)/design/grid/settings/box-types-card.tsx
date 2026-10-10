"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BRAY_BOX_TYPES } from "@/lib/design/conduit-riser/tables";
import type { CRBoxType } from "@/lib/design/conduit-riser/input";
import { BOX_CODE_MAX, BOX_DESC_MAX, BOX_TYPES_MAX, type BoxTypeRowError } from "@/lib/riser-box-types";
import { saveRiserBoxTypesAction } from "./actions";

/**
 * Grid Settings → "Riser box types" (#321): the code + description table the
 * conduit riser prints for the boxes on a sheet ("A — 1-gang standard").
 * Starts as Bray's list; Reset puts it back (then Save). Full-replacement
 * save, strict: a blank / invalid / repeated code or a bad description
 * refuses the save and the card marks those rows (nothing silently drops).
 */

type Row = { code: string; description: string };

const inS: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "7px 10px",
  background: "#fff",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const rowsOf = (types: readonly CRBoxType[]): Row[] => types.map((t) => ({ code: t.code, description: t.description }));

export function BoxTypesCard({ boxTypes }: { boxTypes: CRBoxType[] }) {
  const router = useRouter();
  const [saved, setSaved] = useState<Row[]>(() => rowsOf(boxTypes));
  const [rows, setRows] = useState<Row[]>(() => rowsOf(boxTypes));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<BoxTypeRowError[]>([]);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);
  const overCap = rows.length > BOX_TYPES_MAX;

  const patch = (i: number, p: Partial<Row>) => {
    setJustSaved(false);
    setError(null);
    setRowErrors([]);
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  };

  const onSave = () =>
    startTransition(async () => {
      setError(null);
      setRowErrors([]);
      try {
        const res = await saveRiserBoxTypesAction(rows);
        if (!res.ok) {
          // Per-row errors when the server named rows; a plain message otherwise.
          if (res.errors.length) setRowErrors(res.errors);
          else setError(res.error);
          return;
        }
        const next = rowsOf(res.types);
        setRows(next);
        setSaved(next);
        setJustSaved(true);
        router.refresh();
      } catch {
        setError("Save failed — please try again.");
      }
    });

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Riser box types</div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            The box codes the conduit riser sheet lists in its box-type table. A row needs a code (1–{BOX_CODE_MAX} letters or digits, each used once) and a description.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => {
              setJustSaved(false);
              setError(null);
              setRowErrors([]);
              setRows(rowsOf(BRAY_BOX_TYPES));
            }}
            style={{ fontSize: 12, fontWeight: 600, color: "#5b616e", background: "transparent", border: "none", cursor: "pointer" }}
          >
            Reset to Bray&apos;s list
          </button>
          <button type="button" className="pk-btn-accent" disabled={!dirty || pending || overCap} onClick={onSave} style={{ fontSize: 13 }}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ margin: "12px 18px 0", fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>
          {error}
        </div>
      )}
      {overCap && (
        <div style={{ margin: "12px 18px 0", fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>
          Too many box types to save ({BOX_TYPES_MAX} max) — remove some rows.
        </div>
      )}
      {rowErrors.some((e) => e.row < 0) && (
        <div role="alert" style={{ margin: "12px 18px 0", fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>
          {rowErrors.filter((e) => e.row < 0).map((e) => e.message).join(" ")}
        </div>
      )}
      {justSaved && !dirty && <div style={{ margin: "12px 18px 0", fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>✓ Saved</div>}

      <div style={{ padding: "12px 18px 16px" }}>
        {rows.map((r, i) => {
          const codeErr = rowErrors.find((e) => e.row === i && e.field === "code");
          const descErr = rowErrors.find((e) => e.row === i && e.field === "description");
          const bad = { borderColor: "#e0a493" } as const;
          return (
          <div key={i} style={{ marginBottom: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "76px 1fr 30px", gap: 8 }}>
            <input value={r.code} onChange={(e) => patch(i, { code: e.target.value.toUpperCase() })} maxLength={BOX_CODE_MAX} placeholder="Code" aria-label="Box code" aria-invalid={!!codeErr} style={{ ...inS, fontWeight: 600, textAlign: "center", ...(codeErr ? bad : null) }} />
            <input value={r.description} onChange={(e) => patch(i, { description: e.target.value })} maxLength={BOX_DESC_MAX} placeholder="Description (e.g. 1-gang standard)" aria-label="Box description" aria-invalid={!!descErr} style={{ ...inS, ...(descErr ? bad : null) }} />
            <button
              type="button"
              onClick={() => {
                setJustSaved(false);
                setRowErrors([]);
                setRows((rs) => rs.filter((_, idx) => idx !== i));
              }}
              title="Remove"
              aria-label="Remove box type"
              style={{ width: 30, height: 30, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, color: "#c4c9d2", fontSize: 15, cursor: "pointer" }}
            >
              ×
            </button>
          </div>
          {(codeErr || descErr) && (
            <div role="alert" style={{ fontSize: 11.5, color: "#b4543a", margin: "4px 0 0 2px" }}>
              {[codeErr?.message, descErr?.message].filter(Boolean).join(" ")}
            </div>
          )}
          </div>
          );
        })}
        {rows.length === 0 && <div style={{ padding: "10px 0 8px", color: "#9aa0ab", fontSize: 12.5 }}>No box types — the riser sheet prints no box-type table.</div>}
        <button
          type="button"
          onClick={() => {
            setJustSaved(false);
            setRows((rs) => [...rs, { code: "", description: "" }]);
          }}
          disabled={rows.length >= BOX_TYPES_MAX}
          style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
        >
          + Add box type
        </button>
      </div>
    </div>
  );
}

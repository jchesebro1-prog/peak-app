"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  FIELD_KINDS,
  MAX_FIELD_DEFS,
  type CustomFieldDef,
  type FieldKind,
} from "@/lib/customer-fields";
import { CUSTOMER_TYPES } from "../companies/lib";
import { saveCustomerFieldDefsAction } from "./actions";

/**
 * Admin "Customer fields" editor (#23) — the TaxonomyCard idiom: seeded from
 * the server-resolved defs, whole-list save, server validates + throws →
 * inline error here. Rows are sorted ONCE on mount (the TaxonomyCard
 * no-resort rule — no live re-sort under the cursor). Ids are minted
 * server-side from the label on FIRST save and shown read-only after; the
 * parent keys this card by the saved id set, so a save-then-refresh remounts
 * it with the minted ids in place (a second save can never re-mint).
 */

const KIND_LABEL: Record<FieldKind, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  select: "Dropdown",
  checkbox: "Checkbox",
};

type Row = {
  id: string; // "" until first save
  label: string;
  kind: FieldKind;
  optionsText: string; // dropdown only, one option per line
  appliesTo: string[];
};

const rowOf = (d: CustomFieldDef): Row => ({
  id: d.id,
  label: d.label,
  kind: d.kind,
  optionsText: (d.options ?? []).join("\n"),
  appliesTo: d.appliesTo ?? [],
});

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
};

export function CustomerFieldsCard({ defs }: { defs: CustomFieldDef[] }) {
  const router = useRouter();
  const seed = () => defs.slice().sort((a, b) => a.label.localeCompare(b.label)).map(rowOf);
  const [saved, setSaved] = useState<Row[]>(seed);
  const [rows, setRows] = useState<Row[]>(seed);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);

  const patch = (i: number, p: Partial<Row>) => {
    setJustSaved(false);
    setError(null);
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  };
  const toggleType = (i: number, t: string) =>
    patch(i, {
      appliesTo: rows[i].appliesTo.includes(t)
        ? rows[i].appliesTo.filter((x) => x !== t)
        : [...rows[i].appliesTo, t],
    });
  const addRow = () => {
    setJustSaved(false);
    setRows((rs) => [...rs, { id: "", label: "", kind: "text", optionsText: "", appliesTo: [] }]);
  };
  const removeRow = (i: number) => {
    setJustSaved(false);
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  };

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      try {
        await saveCustomerFieldDefsAction(
          rows.map((r) => ({
            id: r.id || undefined,
            label: r.label,
            kind: r.kind,
            options:
              r.kind === "select"
                ? r.optionsText.split("\n").map((s) => s.trim()).filter(Boolean)
                : undefined,
            appliesTo: r.appliesTo,
          }))
        );
        setSaved(rows);
        setJustSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed — please try again.");
      }
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>Customer fields</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".06em", color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", padding: "3px 9px", borderRadius: 6 }}>
              ADMIN
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            Custom fields shown in the company edit form. Leave the venue types unchecked to show a field on every company.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, fontWeight: 600, color: "#8c919c", background: "#f1f2f5", border: "1px solid #e4e7ec", padding: "4px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>
            {rows.length} of {MAX_FIELD_DEFS}
          </span>
          <button
            type="button"
            disabled={!dirty || pending}
            onClick={onSave}
            style={{ fontSize: 13, fontWeight: 600, border: "none", borderRadius: 9, padding: "9px 16px", cursor: dirty && !pending ? "pointer" : "not-allowed", color: dirty && !pending ? "#fff" : "#aab0bb", background: dirty && !pending ? "var(--accent)" : "#eef0f3", whiteSpace: "nowrap" }}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ margin: "12px 18px 0", fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>
          {error}
        </div>
      )}
      {justSaved && !dirty && (
        <div style={{ margin: "12px 18px 0", fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>✓ Saved</div>
      )}

      <div style={{ padding: "12px 18px 16px" }}>
        {rows.map((r, i) => (
          <div key={r.id || "new-" + i} style={{ border: "1px solid #eef0f3", borderRadius: 10, padding: 12, marginBottom: 10, background: "#fafbfc" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
              <input
                value={r.label}
                onChange={(e) => patch(i, { label: e.target.value })}
                placeholder="Field label (e.g. Referred by)"
                style={{ ...inS, flex: 1, minWidth: 0, fontWeight: 600 }}
              />
              <select
                value={r.kind}
                onChange={(e) => patch(i, { kind: e.target.value as FieldKind })}
                disabled={!!r.id}
                title={r.id ? "The kind is fixed once a field has stored values." : undefined}
                style={{ ...inS, width: 122, cursor: r.id ? "not-allowed" : "pointer", background: r.id ? "#f1f2f5" : "#fff" }}
              >
                {FIELD_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <button
                onClick={() => removeRow(i)}
                title="Remove field (stored values for it stop rendering)"
                style={{ width: 30, height: 30, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, color: "#c4c9d2", fontSize: 15, cursor: "pointer", flexShrink: 0 }}
              >
                ×
              </button>
            </div>
            {r.kind === "select" && (
              <textarea
                value={r.optionsText}
                onChange={(e) => patch(i, { optionsText: e.target.value })}
                placeholder={"One option per line"}
                rows={3}
                style={{ ...inS, resize: "vertical", marginBottom: 9, fontFamily: "var(--font-mono)", fontSize: 12 }}
              />
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {CUSTOMER_TYPES.map((t) => (
                <label key={t} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#5b616e", cursor: "pointer" }}>
                  <input type="checkbox" checked={r.appliesTo.includes(t)} onChange={() => toggleType(i, t)} />
                  {t}
                </label>
              ))}
              <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb" }}>
                {r.id || "id auto on save"}
              </span>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ padding: "18px 0 8px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            No custom fields yet.
          </div>
        )}
        <button
          onClick={addRow}
          disabled={rows.length >= MAX_FIELD_DEFS}
          style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
        >
          + Add field
        </button>
      </div>
    </div>
  );
}

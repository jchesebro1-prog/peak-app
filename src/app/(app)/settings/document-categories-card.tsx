"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { OTHER_CATEGORY, type DocumentCategory } from "@/lib/document-categories";
import { saveDocumentCategoriesAction } from "./actions";

/**
 * Settings → Admin → Document categories (#218) — the CustomerFieldsCard
 * idiom: seeded from the server-resolved list, whole-list save, the server
 * validates and returns the refusal. Keys are minted server-side on first
 * save and shown read-only after (the parent keys this card by the saved
 * key set, so a save remounts it with the minted keys in place). Removing a
 * saved row is "Archived": old files keep their label, new uploads can't
 * pick it. Other can't be archived.
 */

type Row = { key: string; label: string; archived: boolean };

const inS: CSSProperties = {
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

const iconBtn: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  color: "#5b616e",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  width: 28,
  height: 28,
  cursor: "pointer",
};

export function DocumentCategoriesCard({ categories }: { categories: DocumentCategory[] }) {
  const router = useRouter();
  const seed = (): Row[] => categories.map((c) => ({ key: c.key, label: c.label, archived: !!c.archived }));
  const [saved, setSaved] = useState<Row[]>(seed);
  const [rows, setRows] = useState<Row[]>(seed);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);

  const touch = () => {
    setJustSaved(false);
    setError(null);
  };
  const patch = (i: number, p: Partial<Row>) => {
    touch();
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    touch();
    setRows((rs) => {
      const next = rs.slice();
      const t = next[i];
      next[i] = next[j];
      next[j] = t;
      return next;
    });
  };
  const add = () => {
    touch();
    setRows((rs) => [...rs, { key: "", label: "", archived: false }]);
  };
  const drop = (i: number) => {
    touch();
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  };

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      const r = await saveDocumentCategoriesAction(
        rows.map((x) => ({ key: x.key || undefined, label: x.label, archived: x.archived }))
      );
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSaved(rows);
      setJustSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Document categories</div>
        <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 4, lineHeight: 1.5 }}>
          How company, venue and project files are sorted — for the team and in the customer portal. Archive a
          category to stop new uploads using it; files already in it keep the label. Other can&apos;t be archived.
        </div>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.key || `new-${i}`}
          style={{
            display: "grid",
            gridTemplateColumns: "28px 28px minmax(0,1fr) 120px 110px",
            gap: 8,
            alignItems: "center",
            padding: "9px 18px",
            borderBottom: "1px solid #f5f6f8",
            opacity: r.archived ? 0.6 : 1,
          }}
        >
          <button type="button" style={iconBtn} aria-label={`Move ${r.label || "category"} up`} disabled={i === 0} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button type="button" style={iconBtn} aria-label={`Move ${r.label || "category"} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
            ↓
          </button>
          <input
            style={inS}
            value={r.label}
            maxLength={40}
            placeholder="Category name"
            aria-label="Category name"
            onChange={(e) => patch(i, { label: e.target.value })}
          />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.key || "new"}
          </span>
          {r.key ? (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5b616e" }}>
              <input
                type="checkbox"
                checked={r.archived}
                disabled={r.key === OTHER_CATEGORY}
                onChange={(e) => patch(i, { archived: e.target.checked })}
              />
              Archived
            </label>
          ) : (
            <button type="button" className="pk-btn-outline" style={{ fontSize: 12 }} onClick={() => drop(i)}>
              Remove
            </button>
          )}
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", flexWrap: "wrap" }}>
        <button type="button" className="pk-btn-outline" onClick={add}>
          + Add category
        </button>
        <button type="button" className="pk-btn-accent" disabled={!dirty || pending} onClick={onSave}>
          {pending ? "Saving…" : "Save categories"}
        </button>
        {error && (
          <span role="alert" style={{ fontSize: 12, color: "#b03a2e" }}>
            {error}
          </span>
        )}
        {justSaved && !dirty && <span style={{ fontSize: 12, color: "#1f7a52" }}>Saved.</span>}
      </div>
    </div>
  );
}

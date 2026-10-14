"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { SurveyTag } from "@/lib/survey-tags";
import { saveSurveyTagsAction } from "./actions";

/* Settings → Field → Final thoughts tags (#342). The DocumentCategoriesCard idiom: whole-list save, ids minted server-side, a dropped row is kept retired. */

type Row = { id: string; label: string; retired: boolean };

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

export function SurveyTagsCard({ tags }: { tags: SurveyTag[] }) {
  const router = useRouter();
  const seed = (): Row[] => tags.map((t) => ({ id: t.id, label: t.label, retired: !!t.retired }));
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
    setRows((rs) => [...rs, { id: "", label: "", retired: false }]);
  };
  const drop = (i: number) => {
    touch();
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  };

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      const r = await saveSurveyTagsAction(
        rows.map((x) => ({ id: x.id || undefined, label: x.label, retired: x.retired }))
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
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Final thoughts — internal tags</div>
        <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 4, lineHeight: 1.5 }}>
          Quick judgments the surveyor tags at the end of a venue assessment — for the team only, never printed for the customer. Retire a tag to stop offering it; assessments that already carry it keep the label.
        </div>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.id || `new-${i}`}
          style={{
            display: "grid",
            gridTemplateColumns: "28px 28px minmax(0,1fr) 120px 110px",
            gap: 8,
            alignItems: "center",
            padding: "9px 18px",
            borderBottom: "1px solid #f5f6f8",
            opacity: r.retired ? 0.6 : 1,
          }}
        >
          <button type="button" style={iconBtn} aria-label={`Move ${r.label || "tag"} up`} disabled={i === 0} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button type="button" style={iconBtn} aria-label={`Move ${r.label || "tag"} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
            ↓
          </button>
          <input
            style={inS}
            value={r.label}
            maxLength={60}
            placeholder="Tag name"
            aria-label="Tag name"
            onChange={(e) => patch(i, { label: e.target.value })}
          />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.id || "new"}
          </span>
          {r.id ? (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5b616e" }}>
              <input
                type="checkbox"
                checked={r.retired}
                onChange={(e) => patch(i, { retired: e.target.checked })}
              />
              Retired
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
          + Add tag
        </button>
        <button type="button" className="pk-btn-accent" disabled={!dirty || pending} onClick={onSave}>
          {pending ? "Saving…" : "Save tags"}
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

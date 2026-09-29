"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BUILT_IN_VENUE_KINDS,
  BUILT_IN_VENUE_LABELS,
  VENUE_TYPE_LABEL_MAX,
  isBuiltInVenueKind,
  type BuiltInVenueKind,
  type VenueType,
} from "@/lib/venue-types";
import { BUILT_IN_SCHEMATIC_LABEL, defaultBackground, templateEntry, templatesFor } from "@/lib/design/venue-templates";
import { saveVenueTypesAction } from "./actions";

/**
 * Admin "Venue types" editor (#216) — the CustomerFieldsCard idiom: seeded
 * from the server-resolved list, whole-list save, server validates. Keys are
 * minted server-side on first save and shown read-only; the parent keys this
 * card by the saved KEYS so a save that mints one remounts it with the minted
 * keys (a second save can never mint twice), while a rename/archive/reorder
 * save keeps the card mounted so its "✓ Saved" note stays visible (#216 final
 * wave B — keying by the whole list remounted on every save and reset it).
 * Built-ins can be renamed and archived but not removed, and always work like
 * themselves.
 */

type Row = { key: string; label: string; worksLike: string; archived: boolean; background: string };
const rowOf = (t: VenueType): Row => ({ key: t.key, label: t.label, worksLike: t.worksLike, archived: !!t.archived, background: t.background ?? "" });

const inS: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "7px 10px",
  background: "#fff",
  outline: "none",
};
const iconBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  border: "1px solid #e4e7ec",
  background: "#fff",
  borderRadius: 7,
  color: "#8c919c",
  fontSize: 13,
  cursor: "pointer",
  flexShrink: 0,
};

export function VenueTypesCard({ types }: { types: VenueType[] }) {
  const router = useRouter();
  const [saved, setSaved] = useState<Row[]>(() => types.map(rowOf));
  const [rows, setRows] = useState<Row[]>(() => types.map(rowOf));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);
  // The refreshed server list (normalized labels) replaces the local copy when
  // nothing is being edited — adjusted during render, not in an effect.
  const serverSig = JSON.stringify(types.map(rowOf));
  const [seenSig, setSeenSig] = useState(serverSig);
  if (serverSig !== seenSig) {
    setSeenSig(serverSig);
    if (!dirty) {
      setSaved(types.map(rowOf));
      setRows(types.map(rowOf));
    }
  }

  const touch = () => {
    setJustSaved(false);
    setError(null);
  };
  const patch = (i: number, p: Partial<Row>) => {
    touch();
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  };
  const move = (i: number, d: -1 | 1) => {
    touch();
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const next = rs.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const add = () => {
    touch();
    setRows((rs) => [...rs, { key: "", label: "", worksLike: "proscenium", archived: false, background: defaultBackground("proscenium") ?? "" }]);
  };
  const remove = (i: number) => {
    touch();
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  };

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      const res = await saveVenueTypesAction(
        rows.map((r) => ({ key: r.key || undefined, label: r.label, worksLike: r.worksLike, archived: r.archived, background: r.background || null }))
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(rows);
      setJustSaved(true);
      if (res.warning) setError(res.warning);
      router.refresh();
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>Venue types</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".06em", color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", padding: "3px 9px", borderRadius: 6 }}>
              ADMIN
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            The types offered when adding a venue. A venue&apos;s name is &ldquo;Location — Type&rdquo;. &ldquo;Works like&rdquo; sets which design and estimating defaults a type uses. Archived types are hidden from pickers; venues keep them. &ldquo;Background&rdquo; is the drawing its plans start from; a design can still pick another of the same kind.
          </div>
        </div>
        <button
          type="button"
          disabled={!dirty || pending}
          onClick={onSave}
          style={{ fontSize: 13, fontWeight: 600, border: "none", borderRadius: 9, padding: "9px 16px", cursor: dirty && !pending ? "pointer" : "not-allowed", color: dirty && !pending ? "#fff" : "#aab0bb", background: dirty && !pending ? "var(--accent)" : "#eef0f3", whiteSpace: "nowrap" }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
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
        {rows.map((r, i) => {
          const builtIn = isBuiltInVenueKind(r.key);
          return (
            <div key={r.key || "new-" + i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", border: "1px solid #eef0f3", borderRadius: 10, padding: "9px 10px", marginBottom: 8, background: r.archived ? "#f6f7f9" : "#fafbfc" }}>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Move up" style={iconBtn}>↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} title="Move down" style={iconBtn}>↓</button>
              <input
                value={r.label}
                maxLength={VENUE_TYPE_LABEL_MAX}
                onChange={(e) => patch(i, { label: e.target.value })}
                placeholder="Type name (e.g. Gym Stage)"
                style={{ ...inS, flex: "1 1 180px", minWidth: 0, fontWeight: 600 }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#5b616e" }}>
                Works like
                <select
                  value={r.worksLike}
                  disabled={builtIn}
                  onChange={(e) => patch(i, { worksLike: e.target.value, background: defaultBackground(e.target.value as BuiltInVenueKind, r.key || null) ?? "" })}
                  title={builtIn ? "A built-in type always works like itself." : undefined}
                  style={{ ...inS, cursor: builtIn ? "not-allowed" : "pointer", background: builtIn ? "#f1f2f5" : "#fff" }}
                >
                  {BUILT_IN_VENUE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {BUILT_IN_VENUE_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#5b616e" }}>
                Background
                {(() => {
                  const choices = templatesFor(r.worksLike as BuiltInVenueKind);
                  return (
                    <select
                      value={r.background}
                      disabled={choices.length < 2}
                      onChange={(e) => patch(i, { background: e.target.value })}
                      title={choices.length ? "The drawing this type's plans start from." : "No drawing yet for this kind — plans use the built-in schematic."}
                      style={{ ...inS, cursor: choices.length < 2 ? "not-allowed" : "pointer", background: choices.length < 2 ? "#f1f2f5" : "#fff" }}
                    >
                      {/* Blank = this type's default drawing (saved as that drawing's id). */}
                      {choices.length ? (
                        <>
                          <option value="">Venue type default ({templateEntry(defaultBackground(r.worksLike as BuiltInVenueKind, r.key || null))?.label ?? BUILT_IN_SCHEMATIC_LABEL})</option>
                          {choices.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </>
                      ) : <option value="">{BUILT_IN_SCHEMATIC_LABEL}</option>}
                    </select>
                  );
                })()}
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#5b616e", cursor: "pointer" }}>
                <input type="checkbox" checked={r.archived} onChange={(e) => patch(i, { archived: e.target.checked })} />
                Archived
              </label>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", minWidth: 90, textAlign: "right" }}>
                {r.key || "key on save"}
              </span>
              {builtIn ? (
                <span style={{ width: 28 }} />
              ) : (
                <button type="button" onClick={() => remove(i)} title="Remove type (refused while a venue uses it)" style={{ ...iconBtn, color: "#c4c9d2", fontSize: 15 }}>
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button type="button" onClick={add} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
          + Add type
        </button>
      </div>
    </div>
  );
}

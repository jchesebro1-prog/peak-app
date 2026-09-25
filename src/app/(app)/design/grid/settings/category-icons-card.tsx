"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { defaultIconFor, symbolLook, type SymbolCategoryRow, type SymbolContext } from "@/lib/design/grid-icons";
import { SymbolIcon } from "@/components/design/symbol-shape";
import { IconPicker } from "@/components/design/icon-picker";
import { saveCategoryIconsAction } from "./actions";

/**
 * "Category icons" card (stock symbols, spec 2026-09-25 §2) — replaces the
 * D154 8-shape card. One row per live category (server-built by
 * symbolCategoryRows), each with its badge preview in its resolved colour
 * and a searchable IconPicker. Sparse save: only rows that differ from the
 * shipped default are posted (settings.gridCategoryIcons merges per
 * category), so new defaults keep appearing after an admin edits one.
 * "Reset to defaults" clears the key; ↺ on a row returns just that row.
 */

const norm = (s: string) => s.trim().toLowerCase();

/** Stored overrides re-keyed onto the rows' spellings (trimmed, case-insensitive). */
function initialOverrides(rows: SymbolCategoryRow[], stored: Record<string, string> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(stored || {})) {
    const row = rows.find((r) => norm(r.category) === norm(k));
    if (row && v !== defaultIconFor(row.category)) out[row.category] = v;
  }
  return out;
}

export function CategoryIconsCard({
  rows,
  stored,
  ctx,
}: {
  rows: SymbolCategoryRow[];
  stored: Record<string, string> | null;
  ctx: SymbolContext;
}) {
  const router = useRouter();
  const saved = useMemo(() => initialOverrides(rows, stored), [rows, stored]);
  const [overrides, setOverrides] = useState<Record<string, string>>(saved);
  const [filter, setFilter] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = JSON.stringify(overrides) !== JSON.stringify(saved);
  const canSave = dirty && !pending;
  const shown = rows.filter((r) => !filter.trim() || norm(r.category).includes(norm(filter)));

  const setRow = (category: string, iconId: string | null) => {
    setJustSaved(false);
    setError(null);
    setOverrides((o) => {
      const next = { ...o };
      if (!iconId || iconId === defaultIconFor(category)) delete next[category];
      else next[category] = iconId;
      return next;
    });
  };

  const save = (map: Record<string, string>) => {
    setError(null);
    startTransition(async () => {
      try {
        await saveCategoryIconsAction(map);
        setOverrides(map);
        setJustSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed — please try again.");
      }
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "visible", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>Category icons</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".06em", color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", padding: "3px 9px", borderRadius: 6 }}>
              ADMIN
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            The glyph The Grid draws for each catalog category, on the plan, the riser and the legends. A category
            without one draws the generic device; an icon set on a single Grid entry wins.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <button
            type="button"
            disabled={pending}
            onClick={() => save({})}
            style={{ fontSize: 12, fontWeight: 600, color: "#5b616e", background: "transparent", border: "none", cursor: "pointer" }}
          >
            Reset to defaults
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => save(overrides)}
            style={{ fontSize: 13, fontWeight: 600, border: "none", borderRadius: 9, padding: "9px 16px", cursor: canSave ? "pointer" : "not-allowed", color: canSave ? "#fff" : "#aab0bb", background: canSave ? "var(--accent)" : "#eef0f3", whiteSpace: "nowrap" }}
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
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${rows.length} categories`}
          aria-label="Filter categories"
          style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 10px", width: "100%", maxWidth: 320, marginBottom: 10, outline: "none" }}
        />
        {shown.map((r) => {
          const iconId = overrides[r.category] ?? defaultIconFor(r.category);
          const color = symbolLook({ category: r.category, gridScope: r.gridScope }, ctx).color;
          const custom = r.category in overrides;
          return (
            <div key={r.category} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto 30px", gap: 9, alignItems: "center", marginBottom: 7 }}>
              <SymbolIcon iconId={iconId} color={color} size={20} />
              <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.category}
                {custom && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: "#8a6d1f" }}>custom</span>}
              </span>
              <IconPicker value={iconId} color={color} label={`Icon for ${r.category}`} onChange={(id) => setRow(r.category, id)} />
              <button
                type="button"
                onClick={() => setRow(r.category, null)}
                disabled={!custom}
                title="Back to the shipped default"
                aria-label={`Reset ${r.category} to its default icon`}
                style={{ width: 30, height: 30, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, color: custom ? "#5b616e" : "#d5d9e0", fontSize: 14, cursor: custom ? "pointer" : "default" }}
              >
                ↺
              </button>
            </div>
          );
        })}
        {shown.length === 0 && (
          <div style={{ padding: "12px 0", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>No category matches “{filter}”.</div>
        )}
      </div>
    </div>
  );
}

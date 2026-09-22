"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_GRID_CATEGORY_SHAPES,
  GRID_SHAPES,
  GRID_SHAPE_LABEL,
  markerColor,
  type GridShape,
} from "@/lib/design/grid-symbols";
import { SymbolIcon } from "@/components/design/symbol-shape";
import { saveGridCategoryShapesAction } from "./actions";

/**
 * Admin "Grid symbols" card (#131, D154) — the CustomerFieldsCard idiom:
 * seeded from the server-resolved map, whole-map save, sorted ONCE on mount.
 * One row per catalog category → shape; anything not listed draws as a
 * rectangle; a symbol set on a single Grid entry wins over its category.
 *
 * Rows merge two sources (Task 10 controller review): the resolved defaults
 * map (`shapes` — seeded or stored, from resolveCategoryShapes) and the
 * catalog's LIVE categories (`liveCategories`, from listGridSymbols() the
 * same way the Grid editor's page.tsx derives them) — so an admin can see a
 * category no default matches (the shipped catalog uses "control-io", not
 * "Control") and give it a symbol. A live category `shapes` doesn't cover
 * shows "rect" — its real effective value per shapeFor.
 */

type Row = { category: string; shape: GridShape };

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

const norm = (s: string) => s.trim().toLowerCase();

/** `cleanGridCategoryShapes` keeps the first 60 entries and silently drops
 *  the rest, so the card has to refuse a longer list rather than report
 *  "✓ Saved" over edits that never landed. `mergedRows` can seed more than
 *  60 rows on its own (one per live catalog category), so this is reachable
 *  without "+ Add category", which the same cap already disables. */
const MAX_CATEGORIES = 60;

const rowsOf = (map: Record<string, GridShape>): Row[] =>
  Object.entries(map)
    .map(([category, shape]) => ({ category, shape }))
    .sort((a, b) => a.category.localeCompare(b.category));

/** `rowsOf(shapes)` plus one "rect" row per live category not already
 *  covered by `shapes` — matched trimmed + case-insensitive, exactly like
 *  shapeFor's own category lookup, so "already covered" here means the same
 *  thing it means when the plan actually resolves a shape. */
function mergedRows(shapes: Record<string, GridShape>, liveCategories: string[]): Row[] {
  const rows = rowsOf(shapes);
  const covered = new Set(rows.map((r) => norm(r.category)));
  for (const category of liveCategories) {
    const key = norm(category);
    if (!key || covered.has(key)) continue;
    covered.add(key);
    rows.push({ category, shape: "rect" });
  }
  return rows.sort((a, b) => a.category.localeCompare(b.category));
}

export function GridSymbolsCard({
  shapes,
  liveCategories,
}: {
  shapes: Record<string, GridShape>;
  liveCategories: string[];
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<Row[]>(() => mergedRows(shapes, liveCategories));
  const [rows, setRows] = useState<Row[]>(() => mergedRows(shapes, liveCategories));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);
  // Every row's category can be blanked (or all rows removed) without
  // deleting them one-by-one; that would post {} and clear the key, so
  // gate Save on it too, alongside the existing dirty/pending checks.
  const hasContent = rows.some((r) => r.category.trim());
  // Rows beyond the helper's cap are dropped on save, so gate Save on the
  // count of rows that would actually be posted (blank ones are skipped).
  const namedRows = rows.filter((r) => r.category.trim()).length;
  const overCap = namedRows > MAX_CATEGORIES;
  const canSave = dirty && !pending && hasContent && !overCap;

  const patch = (i: number, p: Partial<Row>) => {
    setJustSaved(false);
    setError(null);
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  };
  const addRow = () => {
    setJustSaved(false);
    setRows((rs) => [...rs, { category: "", shape: "rect" }]);
  };
  const removeRow = (i: number) => {
    setJustSaved(false);
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  };
  const restoreDefaults = () => {
    setJustSaved(false);
    setRows(mergedRows(DEFAULT_GRID_CATEGORY_SHAPES, liveCategories));
  };

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      try {
        const map: Record<string, string> = {};
        for (const r of rows) {
          const c = r.category.trim();
          if (c) map[c] = r.shape;
        }
        await saveGridCategoryShapesAction(map);
        if (Object.keys(map).length === 0) {
          // An empty save clears the key, so the plan falls back to the
          // shipped seed (resolveCategoryShapes(null)) — reflect that here
          // instead of leaving the card showing "Saved" over an empty list.
          const fallback = mergedRows(DEFAULT_GRID_CATEGORY_SHAPES, liveCategories);
          setRows(fallback);
          setSaved(fallback);
        } else {
          setSaved(rows);
        }
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
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>Grid symbols</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".06em", color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", padding: "3px 9px", borderRadius: 6 }}>
              ADMIN
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            The symbol The Grid draws for each catalog category, on the plan and the riser. Categories not
            listed draw as a rectangle; a symbol set on a single Grid entry wins over its category.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <button type="button" onClick={restoreDefaults} style={{ fontSize: 12, fontWeight: 600, color: "#5b616e", background: "transparent", border: "none", cursor: "pointer" }}>
            Restore defaults
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={onSave}
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
      {overCap && (
        <div style={{ margin: "12px 18px 0", fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>
          Too many categories to save ({MAX_CATEGORIES} max) — remove some rows.
        </div>
      )}
      {justSaved && !dirty && (
        <div style={{ margin: "12px 18px 0", fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>✓ Saved</div>
      )}

      <div style={{ padding: "12px 18px 16px" }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) 150px 30px", gap: 9, alignItems: "center", marginBottom: 8 }}>
            <SymbolIcon shape={r.shape} color={markerColor(r.category.trim())} size={16} />
            <input
              value={r.category}
              onChange={(e) => patch(i, { category: e.target.value })}
              placeholder="Catalog category (e.g. Speakers)"
              aria-label="Catalog category"
              style={{ ...inS, fontWeight: 600 }}
            />
            <select
              value={r.shape}
              onChange={(e) => patch(i, { shape: e.target.value as GridShape })}
              aria-label="Symbol"
              style={{ ...inS, cursor: "pointer" }}
            >
              {GRID_SHAPES.map((s) => (
                <option key={s} value={s}>{GRID_SHAPE_LABEL[s]}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => removeRow(i)}
              title="Remove (the category draws as a rectangle)"
              aria-label="Remove category"
              style={{ width: 30, height: 30, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, color: "#c4c9d2", fontSize: 15, cursor: "pointer" }}
            >
              ×
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ padding: "18px 0 8px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            No category symbols yet — the shipped defaults apply. Add a category, or use Restore defaults to edit them.
          </div>
        )}
        <button
          type="button"
          onClick={addRow}
          disabled={rows.length >= MAX_CATEGORIES}
          style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
        >
          + Add category
        </button>
      </div>
    </div>
  );
}

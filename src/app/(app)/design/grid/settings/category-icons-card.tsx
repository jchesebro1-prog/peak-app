"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveCategoryIcons, symbolLook, type SymbolCategoryRow, type SymbolContext } from "@/lib/design/grid-icons";
import { SymbolIcon } from "@/components/design/symbol-shape";
import { IconPicker } from "@/components/design/icon-picker";
import { saveCategoryIconsAction } from "./actions";

/**
 * "Advanced: per-category overrides" (#226; was the "Category icons" card,
 * stock symbols spec 2026-09-25 §2). Device type icons are the primary
 * editor now; a stored per-raw-category icon still WINS over its type's
 * icon, so every override an admin already configured keeps working.
 * Collapsed by default, and it lists only categories that have an override
 * or are used in a Grid design ("Show all" lists every live category).
 * Sparse save: only rows that differ from their baseline are posted
 * (settings.gridCategoryIcons merges per category). "Reset to defaults"
 * clears the key; ↺ on a row returns just that row.
 *
 * A row's baseline — what ↺ returns to and what an untouched row previews —
 * is computed with the SAME resolver the plan uses (`symbolLook` over
 * `{category, gridScope, deviceType}`), against a context with every stored
 * override removed, so it shows the device-type icon the plan would draw
 * (final fix wave #2 rule, extended by #226).
 */

const norm = (s: string) => s.trim().toLowerCase();

export function CategoryIconsCard({
  rows,
  stored,
  ctx,
  used,
}: {
  rows: SymbolCategoryRow[];
  stored: Record<string, string> | null;
  ctx: SymbolContext;
  /** Raw categories placed in any Grid design. */
  used: string[];
}) {
  const router = useRouter();
  const baseCtx = useMemo<SymbolContext>(() => ({ ...ctx, categoryIcons: resolveCategoryIcons(null), categoryIconOverrides: {} }), [ctx]);
  const baseIconFor = useCallback(
    (category: string, gridScope: string | null, deviceType: string | null) => symbolLook({ category, gridScope, deviceType }, baseCtx).iconId,
    [baseCtx]
  );
  const rowByCategory = useMemo(() => new Map(rows.map((r) => [r.category, r])), [rows]);
  const usedSet = useMemo(() => new Set(used.map(norm)), [used]);

  const saved = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(stored || {})) {
      const row = rows.find((r) => norm(r.category) === norm(k));
      if (row && v !== baseIconFor(row.category, row.gridScope, row.deviceType ?? null)) out[row.category] = v;
    }
    return out;
  }, [rows, stored, baseIconFor]);
  const [overrides, setOverrides] = useState<Record<string, string>>(saved);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = JSON.stringify(overrides) !== JSON.stringify(saved);
  const canSave = dirty && !pending;
  const relevant = rows.filter((r) => showAll || Object.hasOwn(overrides, r.category) || Object.hasOwn(saved, r.category) || usedSet.has(norm(r.category)));
  const shown = relevant.filter((r) => !filter.trim() || norm(r.category).includes(norm(filter)));

  const setRow = (category: string, iconId: string | null) => {
    setJustSaved(false);
    setError(null);
    setOverrides((o) => {
      const next = { ...o };
      const row = rowByCategory.get(category);
      if (!iconId || iconId === baseIconFor(category, row?.gridScope ?? null, row?.deviceType ?? null)) delete next[category];
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "14px 18px", borderBottom: open ? "1px solid #ececf0" : "none" }}>
        <div style={{ minWidth: 0 }}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            style={{ display: "flex", alignItems: "center", gap: 9, background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", color: "inherit" }}
          >
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>Advanced: per-category overrides</span>
            <span style={{ fontSize: 12, color: "#8c919c" }}>
              {open ? "▾" : "▸"} {Object.keys(saved).length} set
            </span>
          </button>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            A raw catalog category&apos;s own glyph, which beats its device type&apos;s icon. Most categories never need one.
          </div>
        </div>
        {open && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <button type="button" disabled={pending} onClick={() => save({})} style={{ fontSize: 12, fontWeight: 600, color: "#5b616e", background: "transparent", border: "none", cursor: "pointer" }}>
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
        )}
      </div>
      {open && error && (
        <div style={{ margin: "12px 18px 0", fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>{error}</div>
      )}
      {open && justSaved && !dirty && <div style={{ margin: "12px 18px 0", fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>✓ Saved</div>}
      {open && (
        <div style={{ padding: "12px 18px 16px" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filter ${relevant.length} categories`}
              aria-label="Filter categories"
              style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 10px", width: "100%", maxWidth: 320, outline: "none" }}
            />
            <label style={{ fontSize: 12, color: "#5b616e", display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show all {rows.length} categories
            </label>
          </div>
          {shown.map((r) => {
            const hasOverride = Object.hasOwn(overrides, r.category);
            const iconId = hasOverride ? overrides[r.category] : baseIconFor(r.category, r.gridScope, r.deviceType ?? null);
            const color = symbolLook({ category: r.category, gridScope: r.gridScope, deviceType: r.deviceType ?? null }, ctx).color;
            return (
              <div key={r.category} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto 30px", gap: 9, alignItems: "center", marginBottom: 7 }}>
                <SymbolIcon iconId={iconId} color={color} size={20} />
                <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.category}
                  {hasOverride && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: "#8a6d1f" }}>custom</span>}
                </span>
                <IconPicker value={iconId} color={color} label={`Icon for ${r.category}`} onChange={(id) => setRow(r.category, id)} />
                <button
                  type="button"
                  onClick={() => setRow(r.category, null)}
                  disabled={!hasOverride}
                  title="Back to the device type's icon"
                  aria-label={`Reset ${r.category} to its default icon`}
                  style={{ width: 30, height: 30, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, color: hasOverride ? "#5b616e" : "#d5d9e0", fontSize: 14, cursor: hasOverride ? "pointer" : "default" }}
                >
                  ↺
                </button>
              </div>
            );
          })}
          {shown.length === 0 && (
            <div style={{ padding: "12px 0", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
              {filter.trim() ? `No category matches “${filter}”.` : "No overrides yet, and no Grid design uses a category — tick Show all to add one."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

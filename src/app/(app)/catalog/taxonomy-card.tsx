"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GROUPS, TRADES, type CategoryMap, type CatalogGroup, type Trade } from "@/lib/catalog-taxonomy";
import { saveCategoryMapAction } from "./actions";

/**
 * Admin "Categories & trades" mapping editor (punch #39, Task 2). Lists every
 * distinct part category and lets an admin assign it a beta Group and/or
 * Trade — the mapping catalog parts resolve through (see
 * lib/catalog-taxonomy.ts) without rewriting the parts themselves.
 *
 * `Fabric` and `Labor` are semantic categories owned by the curtain
 * configurator / labor engine (see catalog-taxonomy.ts header) — they're
 * shown for completeness but never editable here, and never count toward
 * the "mapped" total.
 *
 * `initialMap` is `resolveCategoryMap(stored)` from the server — defaults
 * merged with whatever's already been saved. Saving sends the FULL map back
 * (see saveCategoryMapAction's comment): categories never touched here still
 * ride along with their seeded default, which is why seeding from the
 * resolved map (not the raw stored patch) matters.
 */

const EXCLUDED = new Set(["Fabric", "Labor"]);

function isMapped(entry: CategoryMap[string] | undefined): boolean {
  return !!(entry?.group || entry?.trade);
}

function sameEntry(a: CategoryMap[string] | undefined, b: CategoryMap[string] | undefined): boolean {
  return (a?.group ?? "") === (b?.group ?? "") && (a?.trade ?? "") === (b?.trade ?? "");
}

const selStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 500,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "7px 26px 7px 10px",
  background: "#fff",
  cursor: "pointer",
  outline: "none",
  minWidth: 150,
};

export function TaxonomyCard({
  categories,
  initialMap,
}: {
  categories: string[];
  initialMap: CategoryMap;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<CategoryMap>(initialMap);
  const [entries, setEntries] = useState<CategoryMap>(initialMap);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const eligible = categories.filter((c) => !EXCLUDED.has(c));
  const mappedCount = eligible.filter((c) => isMapped(entries[c])).length;
  const dirty = categories.some((c) => !sameEntry(entries[c], saved[c]));

  const rows = categories.slice().sort((a, b) => {
    const am = isMapped(entries[a]) ? 1 : 0;
    const bm = isMapped(entries[b]) ? 1 : 0;
    if (am !== bm) return am - bm;
    return a.localeCompare(b);
  });

  const setGroup = (cat: string, value: string) => {
    setJustSaved(false);
    setError(null);
    setEntries((prev) => {
      const cur: CategoryMap[string] = { ...(prev[cat] || {}) };
      if (value) cur.group = value as CatalogGroup;
      else delete cur.group;
      return { ...prev, [cat]: cur };
    });
  };

  const setTrade = (cat: string, value: string) => {
    setJustSaved(false);
    setError(null);
    setEntries((prev) => {
      const cur: CategoryMap[string] = { ...(prev[cat] || {}) };
      if (value) cur.trade = value as Trade;
      else delete cur.trade;
      return { ...prev, [cat]: cur };
    });
  };

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      try {
        await saveCategoryMapAction(entries);
        setSaved(entries);
        setJustSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed — please try again.");
      }
    });
  };

  return (
    <div
      className="pk-card"
      style={{ overflow: "hidden", marginBottom: 18 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          rowGap: 10,
          padding: "14px 18px",
          borderBottom: "1px solid #ececf0",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>Categories &amp; trades</span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: ".06em",
                color: "#8a6d1f",
                background: "#fbf3dd",
                border: "1px solid #f0e2bd",
                padding: "3px 9px",
                borderRadius: 6,
              }}
            >
              ADMIN
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            Map each imported category to a beta Group and Trade so parts roll up correctly.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              fontWeight: 600,
              color: mappedCount === eligible.length ? "#1f7a52" : "#8c919c",
              background: mappedCount === eligible.length ? "#eaf6ef" : "#f1f2f5",
              border: `1px solid ${mappedCount === eligible.length ? "#cce9da" : "#e4e7ec"}`,
              padding: "4px 10px",
              borderRadius: 20,
              whiteSpace: "nowrap",
            }}
          >
            {mappedCount} of {eligible.length} categories mapped
          </span>
          <button
            type="button"
            disabled={!dirty || pending}
            onClick={onSave}
            style={{
              fontSize: 13,
              fontWeight: 600,
              border: "none",
              borderRadius: 9,
              padding: "9px 16px",
              cursor: dirty && !pending ? "pointer" : "not-allowed",
              color: dirty && !pending ? "#fff" : "#aab0bb",
              background: dirty && !pending ? "var(--accent)" : "#eef0f3",
              whiteSpace: "nowrap",
            }}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            margin: "12px 18px 0",
            fontSize: 12,
            color: "#b4543a",
            background: "#f9ece8",
            border: "1px solid #f0d6cd",
            borderRadius: 8,
            padding: "9px 12px",
          }}
        >
          {error}
        </div>
      )}
      {justSaved && !dirty && (
        <div style={{ margin: "12px 18px 0", fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>
          ✓ Saved
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 520 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 168px 168px",
              gap: 12,
              padding: "8px 18px",
              fontSize: 10,
              fontWeight: 600,
              color: "#aab0bb",
              textTransform: "uppercase",
              letterSpacing: ".04em",
              borderBottom: "1px solid #eef0f3",
              background: "#fbfbfc",
              marginTop: 8,
            }}
          >
            <span>Category</span>
            <span>Group</span>
            <span>Trade</span>
          </div>

          {rows.map((cat) => {
            const excluded = EXCLUDED.has(cat);
            const changed = !excluded && !sameEntry(entries[cat], saved[cat]);
            const entry = entries[cat] || {};
            return (
              <div
                key={cat}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) 168px 168px",
                  gap: 12,
                  padding: "10px 18px",
                  alignItems: "center",
                  borderBottom: "1px solid #f3f4f7",
                  background: changed ? "#f7f0e4" : excluded ? "#fafbfc" : "transparent",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: excluded ? "#aab0bb" : "#16181d",
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cat}
                  </span>
                  {excluded && (
                    <span style={{ fontSize: 10.5, color: "#aab0bb", lineHeight: 1.4 }}>
                      excluded (curtain/labor engine)
                    </span>
                  )}
                </span>
                <select
                  value={entry.group ?? ""}
                  disabled={excluded}
                  onChange={(e) => setGroup(cat, e.target.value)}
                  style={{ ...selStyle, ...(excluded ? { background: "#f1f2f5", color: "#aab0bb", cursor: "not-allowed" } : {}) }}
                >
                  <option value="">—</option>
                  {GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
                <select
                  value={entry.trade ?? ""}
                  disabled={excluded}
                  onChange={(e) => setTrade(cat, e.target.value)}
                  style={{ ...selStyle, ...(excluded ? { background: "#f1f2f5", color: "#aab0bb", cursor: "not-allowed" } : {}) }}
                >
                  <option value="">—</option>
                  {TRADES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
          <div style={{ height: 6 }} />
        </div>
      </div>
    </div>
  );
}

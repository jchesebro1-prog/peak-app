"use client";

import { useMemo, useState } from "react";
import type { Department } from "@/lib/portal-departments";

/**
 * Catalog → Departments editor (#251, spec pick 7). One card for the
 * department list (rename, reorder, add, delete) and one table of every
 * catalog category with a single "Department" select per row — a category
 * can only ever be in one department, so a plain select (the same idiom
 * Catalog → Device types uses for its category → type mapping) makes a
 * double-assignment structurally impossible instead of needing the
 * uncheck-the-other-one dance a per-department checklist would require.
 * Moving a category from one draft department to another is instant in the
 * UI; the server (sanitizeDepartments) still re-validates on save.
 *
 * `pending`/`onSave` are owned by the unkeyed wrapper (departments-editor.tsx,
 * #251 fix round 1) — this component only owns the DRAFT editing state, which
 * is exactly what should reset when the key (a stringified `departments`)
 * changes after a save.
 */

type Draft = { key: string; id?: string; name: string };

const OTHER_CHOICE = "";
const INPUT: React.CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12.5, border: "1px solid #e4e7ec", borderRadius: 8, padding: "6px 8px", background: "#fff", color: "#16181d", outline: "none", minWidth: 0 };
const BTN: React.CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600, border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 12px", background: "#fff", color: "#16181d", cursor: "pointer", whiteSpace: "nowrap" };
const PRIMARY: React.CSSProperties = { ...BTN, border: "1px solid transparent", background: "var(--accent)", color: "#fff" };
const OFF: React.CSSProperties = { ...BTN, color: "#aab0bb", cursor: "not-allowed" };
const MINI: React.CSSProperties = { ...BTN, padding: "3px 7px", fontSize: 11.5 };
const CARD: React.CSSProperties = { overflow: "hidden", marginBottom: 18 };
const HEAD: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "14px 18px", borderBottom: "1px solid #ececf0" };
const DEPT_GRID = "56px minmax(0, 1fr) 90px 80px";
const ROW_GRID = "minmax(0, 1fr) 70px 210px";
const ROW_CAP = 300;

function draftKey(d: { id?: string }, i: number): string {
  return d.id ?? `new-${i}`;
}

export default function DepartmentsClient({
  departments,
  categories,
  suggestions,
  pending,
  onSave,
}: {
  departments: Department[];
  categories: Array<{ category: string; count: number }>;
  suggestions: Department[];
  pending: boolean;
  onSave: (payload: Array<{ id?: string; name: string; categories: string[] }>) => void;
}) {
  const initialDrafts = useMemo<Draft[]>(() => departments.map((d, i) => ({ key: draftKey(d, i), id: d.id, name: d.name })), [departments]);
  const initialCatDept = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    departments.forEach((d, i) => {
      const key = draftKey(d, i);
      for (const c of d.categories) m[c] = key;
    });
    return m;
  }, [departments]);

  const [drafts, setDrafts] = useState<Draft[]>(initialDrafts);
  const [catDept, setCatDept] = useState<Record<string, string>>(initialCatDept);
  const [newName, setNewName] = useState("");
  const [filter, setFilter] = useState("");
  const [newCounter, setNewCounter] = useState(0);

  const dirty = JSON.stringify(drafts) !== JSON.stringify(initialDrafts) || JSON.stringify(catDept) !== JSON.stringify(initialCatDept);
  const draftKeys = new Set(drafts.map((d) => d.key));
  const needle = filter.trim().toLowerCase();
  const shown = categories.filter((c) => !needle || c.category.toLowerCase().includes(needle));
  const visible = shown.slice(0, ROW_CAP);

  const save = () => {
    const byKey = new Map<string, string[]>();
    for (const [cat, key] of Object.entries(catDept)) {
      if (!draftKeys.has(key)) continue;
      const arr = byKey.get(key) ?? [];
      arr.push(cat);
      byKey.set(key, arr);
    }
    const payload = drafts.map((d) => ({ id: d.id, name: d.name, categories: byKey.get(d.key) ?? [] }));
    onSave(payload);
  };

  const rename = (i: number, name: string) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, name } : x)));
  const move = (i: number, by: -1 | 1) =>
    setDrafts((d) => {
      const j = i + by;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (i: number) => setDrafts((d) => d.filter((_, j) => j !== i));
  const add = () => {
    const name = newName.trim();
    if (!name) return;
    setDrafts((d) => [...d, { key: `new-${newCounter}`, name }]);
    setNewCounter((n) => n + 1);
    setNewName("");
  };
  const applySuggestions = () => {
    const next: Draft[] = [];
    const nextCatDept: Record<string, string> = {};
    suggestions.forEach((s, i) => {
      const key = `sugg-${i}`;
      next.push({ key, name: s.name });
      for (const c of s.categories) nextCatDept[c] = key;
    });
    setDrafts(next);
    setCatDept(nextCatDept);
  };
  return (
    <>
      <section className="pk-card" style={CARD}>
        <div style={HEAD}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Departments</div>
            <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4 }}>
              Rename, reorder or delete. Anything not assigned below falls into the portal&rsquo;s automatic Other.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {drafts.length === 0 && suggestions.length > 0 && (
              <button type="button" onClick={applySuggestions} style={BTN}>
                Start from suggestions
              </button>
            )}
            <button type="button" disabled={!dirty || pending} onClick={save} style={dirty && !pending ? PRIMARY : OFF}>
              {pending ? "Saving…" : "Save departments"}
            </button>
          </div>
        </div>
        <div style={{ padding: "12px 18px", display: "grid", gap: 6 }}>
          {drafts.map((d, i) => (
            <div key={d.key} style={{ display: "grid", gridTemplateColumns: DEPT_GRID, gap: 8, alignItems: "center" }}>
              <span style={{ display: "flex", gap: 3 }}>
                <button type="button" aria-label={`Move ${d.name} up`} onClick={() => move(i, -1)} disabled={i === 0} style={MINI}>
                  ↑
                </button>
                <button type="button" aria-label={`Move ${d.name} down`} onClick={() => move(i, 1)} disabled={i === drafts.length - 1} style={MINI}>
                  ↓
                </button>
              </span>
              <input value={d.name} onChange={(e) => rename(i, e.target.value)} aria-label="Department name" maxLength={40} style={INPUT} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8c919c", textAlign: "right" }}>
                {Object.values(catDept).filter((k) => k === d.key).length.toLocaleString("en-US")} cats
              </span>
              <button type="button" onClick={() => remove(i)} style={MINI}>
                Delete
              </button>
            </div>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: DEPT_GRID, gap: 8, alignItems: "center", marginTop: 6 }}>
            <span />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
              placeholder="New department, e.g. Audio"
              aria-label="New department name"
              maxLength={40}
              style={INPUT}
            />
            <span />
            <button type="button" onClick={add} disabled={!newName.trim()} style={MINI}>
              + Add
            </button>
          </div>
          {drafts.length === 0 && <div style={{ fontSize: 12.5, color: "#9aa0ab", padding: "6px 0" }}>No departments yet — the portal browses without a tree.</div>}
        </div>
      </section>

      <section className="pk-card" style={CARD}>
        <div style={HEAD}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Catalog categories</div>
            <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4 }}>
              Every category the portal carries, including fixture assemblies. Pick a department for each — a
              category picked here elsewhere moves the moment you choose it.
            </div>
          </div>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter categories" aria-label="Filter categories" style={{ ...INPUT, width: 220 }} />
        </div>
        <div style={{ padding: "6px 18px 14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: ROW_GRID, gap: 8, fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", padding: "8px 0" }}>
            <span>Category</span>
            <span style={{ textAlign: "right" }}>Parts</span>
            <span>Department</span>
          </div>
          {visible.map((c) => {
            return (
              <div key={c.category} style={{ display: "grid", gridTemplateColumns: ROW_GRID, gap: 8, alignItems: "center", padding: "5px 0", borderTop: "1px solid #f3f4f6" }}>
                <span title={c.category} style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.category}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#5b616e", textAlign: "right" }}>{c.count.toLocaleString("en-US")}</span>
                <select
                  value={draftKeys.has(catDept[c.category]) ? catDept[c.category] : OTHER_CHOICE}
                  onChange={(e) => setCatDept((m) => ({ ...m, [c.category]: e.target.value }))}
                  aria-label={`Department for ${c.category}`}
                  style={INPUT}
                >
                  <option value={OTHER_CHOICE}>— Other —</option>
                  {drafts.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.name || "(unnamed)"}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
          {shown.length > ROW_CAP && (
            <div style={{ fontSize: 10.5, color: "#9aa0ab", padding: "6px 0" }}>
              Showing {ROW_CAP} of {shown.length.toLocaleString("en-US")} — narrow the filter.
            </div>
          )}
          {shown.length === 0 && <div style={{ padding: "18px 0", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>No category matches.</div>}
        </div>
      </section>
    </>
  );
}

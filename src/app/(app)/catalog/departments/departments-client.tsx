"use client";

import { useMemo, useState } from "react";
import { computeBulkMove, type Department } from "@/lib/portal-departments";

/**
 * Catalog → Departments editor (#252, spec pick 7; expanded Sep 2026 for a
 * real prod catalog run — 1,010 categories, not the ~300-row dev sample the
 * original ROW_CAP assumed). One card for the department list (rename,
 * reorder, add, delete) and one table of EVERY catalog category with a
 * single "Department" select per row — a category can only ever be in one
 * department, so a plain select (the same idiom Catalog → Device types uses
 * for its category → type mapping) makes a double-assignment structurally
 * impossible instead of needing the uncheck-the-other-one dance a
 * per-department checklist would require. Moving a category from one draft
 * department to another is instant in the UI; the server
 * (sanitizeDepartments) still re-validates on save.
 *
 * `pending`/`onSave` are owned by the unkeyed wrapper (departments-editor.tsx,
 * #252 fix round 1) — this component only owns the DRAFT editing state, which
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
/** Categories are rendered in chunks so 1,010+ rows don't all mount at
 *  once — "Show 200 more" grows the rendered slice. The FILTER itself
 *  still runs over every category (never just the rendered chunk), and
 *  there is no upper cap on how many chunks can be shown. */
const CHUNK = 200;

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
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [deptFilterKey, setDeptFilterKey] = useState(""); // "" = every department
  const [visibleCount, setVisibleCount] = useState(CHUNK);
  const [bulkTarget, setBulkTarget] = useState(OTHER_CHOICE);
  const [reRunConfirm, setReRunConfirm] = useState(false);
  const [newCounter, setNewCounter] = useState(0);

  const dirty = JSON.stringify(drafts) !== JSON.stringify(initialDrafts) || JSON.stringify(catDept) !== JSON.stringify(initialCatDept);
  const draftKeys = useMemo(() => new Set(drafts.map((d) => d.key)), [drafts]);
  const needle = filter.trim().toLowerCase();

  const resetPaging = () => setVisibleCount(CHUNK);

  // The filter always runs over EVERY category (never just the rendered
  // chunk) — `shown` is the full match set; `visible` is what's mounted.
  const shown = useMemo(() => {
    return categories.filter((c) => {
      if (needle && !c.category.toLowerCase().includes(needle)) return false;
      const assigned = draftKeys.has(catDept[c.category]) ? catDept[c.category] : "";
      if (unassignedOnly && assigned !== "") return false;
      if (deptFilterKey && assigned !== deptFilterKey) return false;
      return true;
    });
  }, [categories, needle, unassignedOnly, deptFilterKey, catDept, draftKeys]);

  const visible = useMemo(() => shown.slice(0, visibleCount), [shown, visibleCount]);

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
    setReRunConfirm(false);
  };
  const bulkMove = () => {
    if (!shown.length) return;
    setCatDept((m) => computeBulkMove(m, shown.map((c) => c.category), bulkTarget));
  };
  const bulkTargetLabel = bulkTarget ? drafts.find((d) => d.key === bulkTarget)?.name || "(unnamed)" : "Other";

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
            {suggestions.length > 0 && !reRunConfirm && (
              <button type="button" onClick={() => setReRunConfirm(true)} style={BTN}>
                Re-run suggestions
              </button>
            )}
            <button type="button" disabled={!dirty || pending} onClick={save} style={dirty && !pending ? PRIMARY : OFF}>
              {pending ? "Saving…" : "Save departments"}
            </button>
          </div>
        </div>
        {reRunConfirm && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 18px", background: "#fbf6ea", borderBottom: "1px solid #ececf0", fontSize: 12.5 }}>
            <span style={{ color: "#7a6524" }}>This replaces your current departments in the editor — Save still needed.</span>
            <button type="button" onClick={applySuggestions} style={PRIMARY}>
              Replace
            </button>
            <button type="button" onClick={() => setReRunConfirm(false)} style={BTN}>
              Cancel
            </button>
          </div>
        )}
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
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#5b616e" }}>
              <input
                type="checkbox"
                checked={unassignedOnly}
                onChange={(e) => {
                  setUnassignedOnly(e.target.checked);
                  resetPaging();
                }}
              />
              Unassigned only
            </label>
            <select
              value={deptFilterKey}
              onChange={(e) => {
                setDeptFilterKey(e.target.value);
                resetPaging();
              }}
              aria-label="Filter to department"
              style={INPUT}
            >
              <option value="">In: any department</option>
              {drafts.map((d) => (
                <option key={d.key} value={d.key}>
                  In: {d.name || "(unnamed)"}
                </option>
              ))}
            </select>
            <input
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                resetPaging();
              }}
              placeholder="Filter categories"
              aria-label="Filter categories"
              style={{ ...INPUT, width: 220 }}
            />
          </div>
        </div>
        {drafts.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 18px", borderBottom: "1px solid #ececf0", background: "#fafafb" }}>
            <span style={{ fontSize: 12, color: "#5b616e" }}>
              Move all {shown.length.toLocaleString("en-US")} shown to
            </span>
            <select value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value)} aria-label="Bulk move target department" style={INPUT}>
              <option value={OTHER_CHOICE}>— Other —</option>
              {drafts.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.name || "(unnamed)"}
                </option>
              ))}
            </select>
            <button type="button" onClick={bulkMove} disabled={!shown.length} style={shown.length ? BTN : OFF}>
              Move all {shown.length.toLocaleString("en-US")} shown to {bulkTargetLabel}
            </button>
          </div>
        )}
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
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0 0" }}>
            <span style={{ fontSize: 10.5, color: "#9aa0ab" }}>
              Showing {visible.length.toLocaleString("en-US")} of {shown.length.toLocaleString("en-US")} categories
            </span>
            {visible.length < shown.length && (
              <button type="button" onClick={() => setVisibleCount((n) => n + CHUNK)} style={MINI}>
                Show {Math.min(CHUNK, shown.length - visible.length).toLocaleString("en-US")} more
              </button>
            )}
          </div>
          {shown.length === 0 && <div style={{ padding: "18px 0", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>No category matches.</div>}
        </div>
      </section>
    </>
  );
}

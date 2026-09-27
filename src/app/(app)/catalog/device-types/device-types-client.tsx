"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GRID_LAYERS, type GridLayer } from "@/lib/design/grid-scopes";
import type { DeviceType, TypeReviewRow } from "@/lib/design/device-types";
import { acceptAllSuggestionsAction, assignDeviceTypeAction, mergeDeviceTypeAction, saveDeviceTypesAction } from "./actions";

/**
 * Catalog → Device types editor (#226). Two cards: the type list (rename,
 * reorder, add, archive, merge) and the category mapping table (unmapped
 * first, per-row type select, bulk assign, "Accept all suggestions"). The
 * page keys this component by the type list, so a save that changes types
 * resets the drafts to what the server now holds.
 */

type Result = { ok: true; message?: string } | { ok: false; error: string };
type Draft = { key?: string; label: string; scope: GridLayer; archived?: boolean };
type Show = "unmapped" | "auto" | "all";

const INPUT: React.CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12.5, border: "1px solid #e4e7ec", borderRadius: 8, padding: "6px 8px", background: "#fff", color: "#16181d", outline: "none", minWidth: 0 };
const BTN: React.CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600, border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 12px", background: "#fff", color: "#16181d", cursor: "pointer", whiteSpace: "nowrap" };
const PRIMARY: React.CSSProperties = { ...BTN, border: "1px solid transparent", background: "var(--accent)", color: "#fff" };
const OFF: React.CSSProperties = { ...BTN, color: "#aab0bb", cursor: "not-allowed" };
const MINI: React.CSSProperties = { ...BTN, padding: "3px 7px", fontSize: 11.5 };
const TAG: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 5, marginLeft: 6 };
const CARD: React.CSSProperties = { overflow: "hidden", marginBottom: 18 };
const HEAD: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "14px 18px", borderBottom: "1px solid #ececf0" };
const TYPE_GRID = "56px minmax(0, 1fr) 150px 90px 80px";
const ROW_GRID = "26px minmax(0, 1fr) 70px 210px 210px";
const scopeName = (s: GridLayer) => (s === "Unscoped" ? "General (Unscoped)" : s);
/** Bulk-assign sentinel: distinct from "" (no choice yet) and from a real
 *  type key, so the Assign button can stay disabled until the admin picks
 *  ONE of "a type" or "Unmap" on purpose (#226 fix wave 3 — the old default
 *  of "" meaning Unmap let a stray click silently unmap every selected row). */
const UNMAP_CHOICE = "__unmap__";
/** Rows rendered at once; narrowing the filter/tab brings the rest into view
 *  (same cap style as the Grid palette's 60-row cap, editor.tsx). */
const ROW_CAP = 200;

export default function DeviceTypesClient({
  types,
  rows,
  partCounts,
}: {
  types: DeviceType[];
  rows: TypeReviewRow[];
  partCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const initial = useMemo<Draft[]>(() => types.map((t) => ({ key: t.key, label: t.label, scope: t.scope, archived: !!t.archived })), [types]);
  const [drafts, setDrafts] = useState<Draft[]>(initial);
  const [newLabel, setNewLabel] = useState("");
  const [newScope, setNewScope] = useState<GridLayer>("Lighting");
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeTo, setMergeTo] = useState("");
  const [mergeArmed, setMergeArmed] = useState(false);
  const [show, setShow] = useState<Show>(rows.some((r) => r.status === "unmapped") ? "unmapped" : "all");
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [bulkChoice, setBulkChoice] = useState("");

  // #226 fix wave 3: a selection made under one tab/filter shouldn't survive
  // into a different one — the categories a stale `picked` refers to may not
  // even be on screen any more, and "Assign to N selected" would silently
  // act on rows the admin can no longer see. Adjusted during render (the
  // React-recommended way to reset state when an input changes) rather than
  // in a useEffect, which would set state synchronously and force an extra
  // render pass.
  const scopeKey = `${show}|${filter}`;
  const [pickedScope, setPickedScope] = useState(scopeKey);
  if (scopeKey !== pickedScope) {
    setPickedScope(scopeKey);
    setPicked([]);
  }

  const active = useMemo(() => types.filter((t) => !t.archived), [types]);
  const labelOf = (key: string | null | undefined) => (key ? types.find((t) => t.key === key)?.label ?? key : "");
  const dirty = JSON.stringify(drafts) !== JSON.stringify(initial);
  const needle = filter.trim().toLowerCase();
  const shown = rows.filter((r) => (show === "all" || r.status === show) && (!needle || r.category.toLowerCase().includes(needle)));
  const visible = shown.slice(0, ROW_CAP);
  const tally: Record<Show, number> = {
    unmapped: rows.filter((r) => r.status === "unmapped").length,
    auto: rows.filter((r) => r.status === "auto").length,
    all: rows.length,
  };
  const acceptable = rows.filter((r) => r.status === "unmapped" && !r.entry && r.suggestion && active.some((t) => t.key === r.suggestion!.typeKey)).length;
  const pickedSet = new Set(picked);
  // A "too long to map" row can never be assigned (the server drops it —
  // mapKeyOf), so it's excluded from "select all" and never counted as
  // pickable; only rows currently rendered (within ROW_CAP) are selectable.
  const pickable = visible.filter((r) => r.status !== "toolong");
  const allShownPicked = pickable.length > 0 && pickable.every((r) => pickedSet.has(r.category));

  const run = (fn: () => Promise<Result>, after?: () => void) => {
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setMsg({ ok: true, text: r.message || "Saved." });
        after?.();
        router.refresh();
      } else setMsg({ ok: false, text: r.error });
    });
  };
  const edit = (i: number, patch: Partial<Draft>) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, by: -1 | 1) =>
    setDrafts((d) => {
      const j = i + by;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    setDrafts((d) => [...d, { label, scope: newScope }]);
    setNewLabel("");
  };
  const togglePick = (category: string) => setPicked((p) => (p.includes(category) ? p.filter((c) => c !== category) : [...p, category]));
  const togglePickShown = () =>
    setPicked((p) => (allShownPicked ? p.filter((c) => !pickable.some((r) => r.category === c)) : [...new Set([...p, ...pickable.map((r) => r.category)])]));
  const typeOptions = active.map((t) => (
    <option key={t.key} value={t.key}>
      {t.label}
    </option>
  ));

  return (
    <>
      {msg && (
        <div
          role="status"
          style={{ marginBottom: 12, fontSize: 12.5, borderRadius: 8, padding: "9px 12px", color: msg.ok ? "#1f7a52" : "#b4543a", background: msg.ok ? "#eaf6ef" : "#f9ece8", border: `1px solid ${msg.ok ? "#cfe9da" : "#f0d6cd"}` }}
        >
          {msg.text}
        </div>
      )}

      <section className="pk-card" style={CARD}>
        <div style={HEAD}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Types</div>
            <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4 }}>
              Rename, reorder, add or archive. An archived type maps nothing; its categories show as unmapped.
            </div>
          </div>
          <button type="button" disabled={!dirty || pending} onClick={() => run(() => saveDeviceTypesAction(drafts))} style={dirty && !pending ? PRIMARY : OFF}>
            {pending ? "Saving…" : "Save types"}
          </button>
        </div>
        <div style={{ padding: "12px 18px", display: "grid", gap: 6 }}>
          {drafts.map((d, i) => (
            <div key={d.key ?? `new-${i}`} style={{ display: "grid", gridTemplateColumns: TYPE_GRID, gap: 8, alignItems: "center", opacity: d.archived ? 0.55 : 1 }}>
              <span style={{ display: "flex", gap: 3 }}>
                <button type="button" aria-label={`Move ${d.label} up`} onClick={() => move(i, -1)} disabled={i === 0} style={MINI}>
                  ↑
                </button>
                <button type="button" aria-label={`Move ${d.label} down`} onClick={() => move(i, 1)} disabled={i === drafts.length - 1} style={MINI}>
                  ↓
                </button>
              </span>
              <input value={d.label} onChange={(e) => edit(i, { label: e.target.value })} aria-label="Type name" maxLength={40} style={INPUT} />
              <select value={d.scope} onChange={(e) => edit(i, { scope: e.target.value as GridLayer })} aria-label={`Scope for ${d.label}`} style={INPUT}>
                {GRID_LAYERS.map((s) => (
                  <option key={s} value={s}>
                    {scopeName(s)}
                  </option>
                ))}
              </select>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8c919c", textAlign: "right" }}>
                {d.key ? `${(partCounts[d.key] || 0).toLocaleString("en-US")} parts` : "new"}
              </span>
              <button type="button" onClick={() => edit(i, { archived: !d.archived })} style={MINI}>
                {d.archived ? "Restore" : "Archive"}
              </button>
            </div>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: TYPE_GRID, gap: 8, alignItems: "center", marginTop: 6 }}>
            <span />
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
              placeholder="New type, e.g. Fog & Haze"
              aria-label="New type name"
              maxLength={40}
              style={INPUT}
            />
            <select value={newScope} onChange={(e) => setNewScope(e.target.value as GridLayer)} aria-label="New type scope" style={INPUT}>
              {GRID_LAYERS.map((s) => (
                <option key={s} value={s}>
                  {scopeName(s)}
                </option>
              ))}
            </select>
            <span />
            <button type="button" onClick={add} disabled={!newLabel.trim()} style={MINI}>
              + Add
            </button>
          </div>
        </div>
        <div style={{ padding: "12px 18px 16px", borderTop: "1px solid #ececf0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Merge</span>
          <select
            value={mergeFrom}
            onChange={(e) => {
              setMergeFrom(e.target.value);
              setMergeArmed(false);
            }}
            aria-label="Type to merge"
            style={INPUT}
          >
            <option value="">Type to merge…</option>
            {typeOptions}
          </select>
          <span style={{ fontSize: 12.5, color: "#8c919c" }}>into</span>
          <select
            value={mergeTo}
            onChange={(e) => {
              setMergeTo(e.target.value);
              setMergeArmed(false);
            }}
            aria-label="Merge into"
            style={INPUT}
          >
            <option value="">Target type…</option>
            {active
              .filter((t) => t.key !== mergeFrom)
              .map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
          </select>
          {!mergeArmed ? (
            <button
              type="button"
              disabled={!mergeFrom || !mergeTo || mergeFrom === mergeTo || pending || dirty}
              title={dirty ? "Save or undo the type edits first" : undefined}
              onClick={() => setMergeArmed(true)}
              style={!mergeFrom || !mergeTo || mergeFrom === mergeTo || dirty ? OFF : BTN}
            >
              Merge…
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () => mergeDeviceTypeAction(mergeFrom, mergeTo),
                    () => {
                      setMergeArmed(false);
                      setMergeFrom("");
                      setMergeTo("");
                    }
                  )
                }
                style={PRIMARY}
              >
                Move every {labelOf(mergeFrom)} category to {labelOf(mergeTo)} and archive {labelOf(mergeFrom)}
              </button>
              <button type="button" onClick={() => setMergeArmed(false)} style={BTN}>
                Cancel
              </button>
            </>
          )}
        </div>
      </section>

      <section className="pk-card" style={CARD}>
        <div style={HEAD}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Catalog categories</div>
            <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4 }}>
              Every raw category in the catalog. <strong>auto</strong> = applied by a confident match; change it to make it yours.
            </div>
          </div>
          <button type="button" disabled={!acceptable || pending} onClick={() => run(() => acceptAllSuggestionsAction())} style={acceptable && !pending ? PRIMARY : OFF}>
            Accept all suggestions ({acceptable})
          </button>
        </div>
        <div style={{ padding: "12px 18px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid #ececf0" }}>
          {(["unmapped", "auto", "all"] as Show[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setShow(s)}
              aria-pressed={show === s}
              style={{ ...MINI, background: show === s ? "#16181d" : "#fff", color: show === s ? "#fff" : "#3d424e", borderColor: show === s ? "#16181d" : "#e4e7ec" }}
            >
              {s === "unmapped" ? "Unmapped" : s === "auto" ? "Auto" : "All"} {tally[s]}
            </button>
          ))}
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter categories" aria-label="Filter categories" style={{ ...INPUT, width: 220 }} />
          <span style={{ flex: 1 }} />
          <select value={bulkChoice} onChange={(e) => setBulkChoice(e.target.value)} aria-label="Type for the selected categories" style={INPUT}>
            <option value="">Choose a type…</option>
            {typeOptions}
            <option value={UNMAP_CHOICE}>Unmap</option>
          </select>
          <button
            type="button"
            disabled={!picked.length || !bulkChoice || pending}
            onClick={() => {
              if (bulkChoice === UNMAP_CHOICE) {
                if (!window.confirm(`Unmap ${picked.length} selected ${picked.length === 1 ? "category" : "categories"}? They'll show as unmapped until someone picks a type.`)) return;
                run(() => assignDeviceTypeAction(picked, null), () => {
                  setPicked([]);
                  setBulkChoice("");
                });
                return;
              }
              run(() => assignDeviceTypeAction(picked, bulkChoice), () => {
                setPicked([]);
                setBulkChoice("");
              });
            }}
            style={picked.length && bulkChoice && !pending ? PRIMARY : OFF}
          >
            {bulkChoice === UNMAP_CHOICE ? `Unmap ${picked.length} selected` : `Assign to ${picked.length} selected`}
          </button>
        </div>
        <div style={{ padding: "6px 18px 14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: ROW_GRID, gap: 8, alignItems: "center", fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", padding: "8px 0" }}>
            <input type="checkbox" aria-label="Select every shown category" checked={allShownPicked} onChange={togglePickShown} />
            <span>Category</span>
            <span style={{ textAlign: "right" }}>Parts</span>
            <span>Suggested</span>
            <span>Device type</span>
          </div>
          {visible.map((r) => (
            <div key={r.key} style={{ display: "grid", gridTemplateColumns: ROW_GRID, gap: 8, alignItems: "center", padding: "5px 0", borderTop: "1px solid #f3f4f6" }}>
              <input
                type="checkbox"
                aria-label={`Select ${r.category}`}
                checked={pickedSet.has(r.category)}
                onChange={() => togglePick(r.category)}
                disabled={r.status === "toolong"}
              />
              <span title={r.category} style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.category}
                {r.status === "auto" && <span style={{ ...TAG, color: "#1f5fa8", background: "#e8f0fb" }}>auto</span>}
                {r.status === "toolong" && <span style={{ ...TAG, color: "#8a6d1f", background: "#fbf3dd" }}>too long to map</span>}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#5b616e", textAlign: "right" }}>{r.count.toLocaleString("en-US")}</span>
              <span style={{ fontSize: 12, color: "#5b616e", minWidth: 0 }}>
                {r.suggestion ? (
                  <>
                    {labelOf(r.suggestion.typeKey)}
                    <span
                      style={{
                        ...TAG,
                        color: r.suggestion.confidence === "high" ? "#1f7a52" : "#8a6d1f",
                        background: r.suggestion.confidence === "high" ? "#eaf6ef" : "#fbf3dd",
                      }}
                    >
                      {r.suggestion.confidence}
                    </span>
                  </>
                ) : (
                  <span style={{ color: "#b7bcc6" }}>—</span>
                )}
              </span>
              {r.status === "toolong" ? (
                <span style={{ fontSize: 12, color: "#9aa0ab" }}>Too long to map — over 120 characters</span>
              ) : (
                <select
                  value={r.typeKey ?? ""}
                  disabled={pending}
                  onChange={(e) => run(() => assignDeviceTypeAction([r.category], e.target.value || null))}
                  aria-label={`Device type for ${r.category}`}
                  style={INPUT}
                >
                  <option value="">— Unmapped —</option>
                  {typeOptions}
                </select>
              )}
            </div>
          ))}
          {shown.length > ROW_CAP && (
            <div style={{ fontSize: 10.5, color: "#9aa0ab", padding: "6px 0" }}>
              Showing {ROW_CAP} of {shown.length.toLocaleString("en-US")} — narrow the filter.
            </div>
          )}
          {shown.length === 0 && (
            <div style={{ padding: "18px 0", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
              {show === "unmapped" && !needle ? "Every category has a device type." : "No category matches."}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

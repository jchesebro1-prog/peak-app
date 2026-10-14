"use client";

/* The section rail shared by the Assessments engine editor (one row per scope) and the Venue Assessments editor
   (one row per section) — #342, extracted from assessments/[id]/scope-rail.tsx. A row is a progress ring, a label,
   done/total and badges. Below 760 px wide the rail hides and a sticky <select> takes its place. Include
   SECTION_RAIL_CSS once in the page's <style>. */
import { useEffect, useRef, type ReactNode } from "react";

export type RailBadge = { tone: "prompt" | "photo"; n: number; title: string; text: string };
export type RailItem = { key: string; label: string; done: number; total: number; badges?: RailBadge[]; muted?: boolean };

export const SECTION_RAIL_CSS = `
  .sr-rail { padding: 6px; position: sticky; top: 12px; }
  .sr-rail-sheet { display: none; }
  .sr-rail-row { display: flex; align-items: center; gap: 9px; width: 100%; text-align: left; background: none; border: 0; border-radius: 8px; padding: 8px 10px; cursor: pointer; font: inherit; color: #3a3f4a; }
  .sr-rail-row:hover { background: #f6f7f9; }
  .sr-rail-row.on { background: #f1f2f5; font-weight: 600; }
  .sr-rail-row.muted { opacity: .55; }
  .sr-rail-title { display: block; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sr-mono-sm { font-family: var(--font-mono); font-size: 11px; color: #8c919c; font-weight: 400; }
  @media (max-width: 759px) {
    .sr-rail { display: none; }
    .sr-rail-sheet { display: block; position: sticky; top: 0; z-index: 15; background: var(--bg, #f7f8fa); padding: 6px 0 10px; }
  }
`;

export function Ring({ done, total }: { done: number; total: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r={r} fill="none" stroke="#e8eaef" strokeWidth="3" />
      <circle
        cx="12" cy="12" r={r} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"
        strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

export function Badge({ n, title, tone }: { n: number; title: string; tone: "prompt" | "photo" }) {
  if (!n) return null;
  const s = tone === "prompt" ? { color: "#9a5b12", background: "#fdf3e3", border: "1px solid #f1dcb6" } : { color: "#5b616e", background: "#f1f2f5", border: "1px solid #e4e7ec" };
  return (
    <span title={title} style={{ ...s, fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, padding: "1px 6px", borderRadius: 20, whiteSpace: "nowrap" }}>
      {tone === "prompt" ? "!" : (
        <svg width="10" height="9" viewBox="0 0 10 9" aria-hidden="true" style={{ verticalAlign: "-1px" }}>
          <path d="M1 2.5h2l1-1.5h2l1 1.5h2v5.5H1z" fill="none" stroke="currentColor" strokeWidth="1" />
          <circle cx="5" cy="5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      )} {n}
    </span>
  );
}

/** The phone select's option text: "Title — 3/7 · 2 to review · 1 photo". */
export function railSheetLabel(item: RailItem, showEmpty = false): string {
  const count = item.total > 0 || showEmpty ? ` — ${item.done}/${item.total}` : "";
  const badges = (item.badges || []).filter((b) => b.n > 0).map((b) => ` · ${b.text}`).join("");
  return `${item.label}${count}${badges}`;
}

export function SectionRail({
  items, active, onPick, ariaLabel, sheetLabel, footer, top, maxHeight, showEmpty = false,
}: {
  items: RailItem[];
  active: string;
  onPick: (key: string) => void;
  ariaLabel: string;
  sheetLabel: string;
  footer?: ReactNode;
  /** sticky offset (px) under a sticky page header */
  top?: number;
  /** cap the desktop rail's height (px); a taller list scrolls inside the rail instead of running past the pane */
  maxHeight?: number;
  /** show the ring and 0/0 for items without fields (the engine's scopes) */
  showEmpty?: boolean;
}) {
  const stick = top != null ? { top } : undefined;
  const navRef = useRef<HTMLElement | null>(null);
  // keep the active row inside the rail's own scroll area (sets the nav's scrollTop only — never scrolls the page)
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || maxHeight == null) return;
    const row = nav.querySelector<HTMLElement>(".sr-rail-row.on");
    if (!row || nav.clientHeight === 0) return;
    const nr = nav.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    if (rr.top < nr.top) nav.scrollTop -= nr.top - rr.top + 6;
    else if (rr.bottom > nr.bottom) nav.scrollTop += rr.bottom - nr.bottom + 6;
  }, [active, maxHeight]);
  const navStyle = maxHeight != null ? { ...stick, maxHeight, overflowY: "auto" as const } : stick;
  return (
    <>
      <div className="sr-rail-sheet" style={stick}>
        <select className="pk-input" aria-label={sheetLabel} value={active} onChange={(e) => onPick(e.target.value)}>
          {items.map((it) => <option key={it.key} value={it.key}>{railSheetLabel(it, showEmpty)}</option>)}
        </select>
      </div>
      <nav ref={navRef} className="sr-rail pk-card" aria-label={ariaLabel} style={navStyle}>
        {items.map((it) => {
          const counted = it.total > 0 || showEmpty;
          return (
            <button key={it.key} type="button" className={`sr-rail-row${it.key === active ? " on" : ""}${it.muted ? " muted" : ""}`} aria-current={it.key === active} onClick={() => onPick(it.key)}>
              {counted ? <Ring done={it.done} total={it.total} /> : <span style={{ width: 24, flexShrink: 0 }} aria-hidden="true" />}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="sr-rail-title">{it.label}</span>
                {counted && <span className="sr-mono-sm">{it.done}/{it.total}</span>}
              </span>
              {(it.badges || []).map((b, i) => <Badge key={i} n={b.n} tone={b.tone} title={b.title} />)}
            </button>
          );
        })}
        {footer}
      </nav>
    </>
  );
}

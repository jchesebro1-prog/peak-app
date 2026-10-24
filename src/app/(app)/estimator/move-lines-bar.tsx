"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type KeyboardEvent } from "react";
import { describeLineMove, planLineMove, type LineMoveTarget, type LineRef } from "@/lib/estimate-line-move/move";
import { groupBlocks, type SystemGroup } from "@/lib/estimate-groups/groups";
import type { MoveSystemTarget } from "./actions";
import type { QuoteLite, SpecSection } from "./types";
import { ACCENT_INK, ACCENT_SOFT } from "./est-ui";
import { REVISE_FIRST, repriceLocked } from "@/lib/estimate-reprice/lock";

/**
 * #357 — the Build step's Move bar: "N selected · Move to ▾ · Clear", the Move
 * to menu (this estimate's systems under their group headings, New system…,
 * Another estimate…) and a preview of every side effect before anything moves.
 * The rules live in `@/lib/estimate-line-move/move`; this only asks and shows.
 */

type MoveHere = { kind: "system"; sectionId: string } | { kind: "new"; name: string };

type MoveLinesBarProps = {
  sections: SpecSection[];
  groups: SystemGroup[];
  /** What the bar acts on (the ticks, or one row's line) — by system + id: ids repeat across systems. */
  lines: LineRef[];
  /** Opened from one row's ⇄ (the label shows that line; there is no idle state). */
  single: boolean;
  /** Start with the menu open (row ⇄). */
  openMenu: boolean;
  moving: boolean;
  /** Clears ticks (or ends single mode). */
  onClear: () => void;
  onMoveHere: (target: MoveHere) => void;
  onMoveToEstimate: (dest: MoveSystemTarget) => void;
  searchQuotes: (q: string) => Promise<QuoteLite[]>;
  /** The hook's current move error (its moveNotice when not ok). Shown only for a move this bar started. */
  moveError?: string;
};

type Mode = "idle" | "menu" | "name" | "estimate" | "confirm";
type Pending =
  | { kind: "system"; sectionId: string; label: string }
  | { kind: "new"; name: string }
  | { kind: "estimate"; dest: MoveSystemTarget; label: string };

/** A "new" preview id that names no real section (sections are `sys<n>` / legacy ids). */
const PREVIEW_NEW_ID = "__preview_new__";
const NAME_MAX = 120;
const DEFAULT_NEW_NAME = "New System";

const BTN: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 600,
  color: "#5b616e",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "6px 11px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const PRIMARY: CSSProperties = { ...BTN, color: "#fff", background: "var(--accent)", borderColor: "var(--accent)" };
const HEAD: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  color: "#9aa0ab",
  letterSpacing: ".06em",
  textTransform: "uppercase",
};
const ITEM: CSSProperties = {
  width: "100%",
  display: "block",
  textAlign: "left",
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 600,
  color: "#16181d",
  background: "#fff",
  border: "1px solid #eef0f3",
  borderRadius: 8,
  padding: "7px 10px",
  cursor: "pointer",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const FIELD: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  padding: "8px 9px",
  background: "#fff",
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const statusLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function MoveLinesBar(p: MoveLinesBarProps) {
  const { sections, groups, lines, single } = p;
  const [mode, setMode] = useState<Mode>(p.openMenu || single ? "menu" : "idle");
  const [pending, setPending] = useState<Pending | null>(null);
  const [newName, setNewName] = useState(DEFAULT_NEW_NAME);
  /** An estimate move this bar started: "start" on the click, "running" once the hook's
   *  `moving` is seen true. The bar stays up ("Moving…") until `moving` drops. */
  const [waiting, setWaiting] = useState<false | "start" | "running">(false);
  /** The error of the last estimate move this bar started — never an older notice. */
  const [failure, setFailure] = useState("");

  const menuRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Kept in a ref (not an effect dep): the parent recreates this closure every render.
  const searchQuotesRef = useRef(p.searchQuotes);
  useEffect(() => {
    searchQuotesRef.current = p.searchQuotes;
  });

  /* An estimate move ending. A success never gets here: its lines leave the
     estimate, so the parent unmounts this bar (and Build resets the row ⇄). So
     moving → false with the bar still up is a failure (or a move the hook
     refused): nothing changes, the ticks stay, the bar stays on the preview with
     the error and Move enabled for a retry. Adjusted during render (React's
     "storing information from previous renders"), not in an effect. */
  if (waiting === "start" && p.moving) setWaiting("running");
  else if (waiting && !p.moving) {
    setWaiting(false);
    setFailure(waiting === "running" ? p.moveError || "Could not move those lines." : "");
  }

  /* ---------- estimate search (the same debounce + sequence guard as section-card's Move picker) ---------- */
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<QuoteLite[]>([]);
  const [searching, startSearch] = useTransition();
  const seq = useRef(0);
  useEffect(() => {
    if (mode !== "estimate") return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      startSearch(async () => {
        try {
          const found = await searchQuotesRef.current(query.trim());
          if (my === seq.current) setHits(found);
        } catch {
          if (my === seq.current) setHits([]);
        }
      });
    }, 260);
    return () => clearTimeout(t);
  }, [mode, query]);

  /* ---------- focus: first menu item / the name / the search / Move ---------- */
  useEffect(() => {
    if (mode === "menu") menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    else if (mode === "name") nameRef.current?.select();
    else if (mode === "estimate") searchRef.current?.focus();
    else if (mode === "confirm") confirmRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [mode]);

  /** A system that already holds every selected line is no target (a line is its system + id). */
  const holdsAll = (secId: string) => lines.length > 0 && lines.every((r) => r.sectionId === secId);

  const singleLine = useMemo(() => {
    if (!single || lines.length !== 1) return null;
    return sections.find((s) => s.id === lines[0].sectionId)?.items.find((x) => x.id === lines[0].id) || null;
  }, [single, lines, sections]);

  const planTarget: LineMoveTarget | null = !pending
    ? null
    : pending.kind === "system"
    ? { kind: "system", sectionId: pending.sectionId }
    : pending.kind === "new"
    ? { kind: "new", id: PREVIEW_NEW_ID, name: pending.name }
    : { kind: "estimate" };
  const targetLabel = !pending
    ? ""
    : pending.kind === "system"
    ? sections.find((s) => s.id === pending.sectionId)?.name || pending.label
    : pending.kind === "new"
    ? pending.name
    : pending.label;
  const plan = planTarget ? planLineMove(sections, lines, planTarget) : null;
  const effects = plan && !plan.noop ? describeLineMove(plan, sections, targetLabel) : [];
  const titleTarget = !pending
    ? ""
    : pending.kind === "system"
    ? targetLabel
    : pending.kind === "new"
    ? `a new system "${pending.name}"`
    : pending.dest.kind === "new"
    ? "a new estimate"
    : pending.label;

  /** Back out one level: single mode has no idle bar, so leaving the menu ends it. */
  const close = () => {
    setPending(null);
    setFailure("");
    if (single) p.onClear();
    else setMode("idle");
  };

  const confirm = (next: Pending) => {
    setPending(next);
    setFailure("");
    setMode("confirm");
  };

  const runMove = () => {
    if (!pending || !plan || plan.noop || p.moving || waiting) return;
    setFailure("");
    if (pending.kind === "estimate") {
      setWaiting("start");
      p.onMoveToEstimate(pending.dest);
      return;
    }
    p.onMoveHere(pending.kind === "system" ? { kind: "system", sectionId: pending.sectionId } : { kind: "new", name: pending.name });
    p.onClear();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || waiting) return;
    if (mode === "idle") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  const busy = !!waiting || p.moving;
  const countLabel = singleLine ? singleLine.desc : `${lines.length} selected`;

  /* ---------- the menu: systems in rail order under their group headings ---------- */
  const menu = () => {
    // Rail order: the same blocks the Build rail and cards render (ungrouped first, then each group).
    const blocks = groupBlocks(sections, groups);
    const ordered = blocks.flatMap((b) => b.sections);
    const heads = blocks.flatMap((b) => b.sections.map((_, j) => (j === 0 ? b.group : null)));
    return (
      <div ref={menuRef} style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10, maxHeight: "min(50vh, 360px)", overflowY: "auto" }}>
        {ordered.map((sec, i) => {
          const group = heads[i];
          const already = holdsAll(sec.id);
          return (
            <Fragment key={sec.id}>
              {group && (
                <div style={{ ...HEAD, margin: "6px 2px 2px" }}>
                  {group.name}
                  {group.alternate ? " · Alternate" : ""}
                </div>
              )}
              <button
                type="button"
                disabled={already}
                title={already ? "Already there" : undefined}
                onClick={() => confirm({ kind: "system", sectionId: sec.id, label: sec.name })}
                style={{ ...ITEM, ...(already ? { color: "#aab0bb", background: "#f7f8fa", cursor: "not-allowed" } : null) }}
              >
                {sec.name || "Untitled system"}
              </button>
            </Fragment>
          );
        })}
        <div role="separator" style={{ height: 1, background: "#eef0f3", margin: "6px 0" }} />
        <button
          type="button"
          onClick={() => {
            setNewName(DEFAULT_NEW_NAME);
            setMode("name");
          }}
          style={{ ...ITEM, color: ACCENT_INK, background: ACCENT_SOFT, borderColor: "transparent" }}
        >
          New system…
        </button>
        <button type="button" onClick={() => setMode("estimate")} style={{ ...ITEM, color: ACCENT_INK, background: ACCENT_SOFT, borderColor: "transparent" }}>
          Another estimate…
        </button>
        <div style={{ marginTop: 4 }}>
          <button type="button" onClick={close} style={BTN}>
            Cancel
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      role="region"
      aria-label="Move selected lines"
      onKeyDown={onKeyDown}
      style={{
        position: "sticky",
        bottom: 12,
        zIndex: 20,
        marginTop: 12,
        maxWidth: "100%",
        boxSizing: "border-box",
        background: "#fff",
        border: "1px solid #e3e6ec",
        borderRadius: 12,
        boxShadow: "0 8px 28px rgba(22,24,29,.14)",
        padding: "10px 14px",
        fontSize: 13,
        color: "#16181d",
      }}
    >
      {/* The header row: what is selected, and (idle) the two actions. */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, minWidth: 0 }}>
        <span style={{ minWidth: 0, flex: "1 1 160px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {singleLine ? (
            <>
              <span style={{ ...HEAD, marginRight: 6 }}>Move</span>
              {countLabel}
            </>
          ) : (
            <>
              <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{lines.length}</span> selected
            </>
          )}
        </span>
        {mode === "idle" && !single && (
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setMode("menu")} style={PRIMARY}>
              Move to ▾
            </button>
            <button type="button" onClick={p.onClear} style={BTN}>
              Clear
            </button>
          </span>
        )}
      </div>

      {mode === "menu" && menu()}

      {mode === "name" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            confirm({ kind: "new", name: newName.trim() || DEFAULT_NEW_NAME });
          }}
          style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}
        >
          <label style={{ ...HEAD, display: "block" }} htmlFor="move-lines-new-name">
            New system name
          </label>
          <input
            id="move-lines-new-name"
            ref={nameRef}
            autoFocus
            value={newName}
            maxLength={NAME_MAX}
            onChange={(e) => setNewName(e.target.value)}
            style={FIELD}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit" style={PRIMARY}>
              Next
            </button>
            <button type="button" onClick={() => setMode("menu")} style={BTN}>
              Back
            </button>
          </div>
        </form>
      )}

      {mode === "estimate" && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            type="button"
            onClick={() => confirm({ kind: "estimate", dest: { kind: "new" }, label: "a new estimate" })}
            style={{ ...ITEM, color: ACCENT_INK, background: ACCENT_SOFT, borderColor: "transparent" }}
          >
            + New estimate
          </button>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search estimates by number, name or customer…"
            aria-label="Search estimates"
            style={FIELD}
          />
          <div style={{ fontSize: 10.5, color: "#aab0bb" }} aria-live="polite">
            {searching ? "Searching…" : hits.length === 0 ? "No other estimates match." : plural(hits.length, "estimate")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "min(40vh, 300px)", overflowY: "auto" }}>
            {hits.map((hit) => (
              <button
                key={hit.id}
                type="button"
                // #368: a sent / won / lost estimate keeps its prices — greyed, refused server-side too.
                disabled={repriceLocked(hit.status)}
                title={repriceLocked(hit.status) ? REVISE_FIRST : undefined}
                onClick={() => confirm({ kind: "estimate", dest: { kind: "existing", quoteId: hit.id }, label: `${hit.number} · ${hit.name || hit.customer}` })}
                style={{ ...ITEM, whiteSpace: "normal", display: "flex", flexDirection: "column", gap: 2, ...(repriceLocked(hit.status) ? { cursor: "not-allowed", opacity: 0.5 } : {}) }}
              >
                <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{hit.name}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 400, color: "#aab0bb", overflowWrap: "anywhere" }}>
                  {hit.number}
                  {hit.customer ? " · " + hit.customer : ""}
                  {" · " + statusLabel(hit.status)}
                </span>
              </button>
            ))}
          </div>
          <div>
            <button type="button" onClick={() => setMode("menu")} style={BTN}>
              Back
            </button>
          </div>
        </div>
      )}

      {mode === "confirm" && pending && plan && (
        <div ref={confirmRef} style={{ marginTop: 10 }}>
          {plan.noop ? (
            <div style={{ fontWeight: 600 }}>Nothing to move</div>
          ) : (
            <>
              <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                Move {plural(plan.lines.length, "line")} to {titleTarget}?
              </div>
              {failure && (
                <div role="alert" style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: "#9a2f22", overflowWrap: "anywhere" }}>
                  {failure}
                </div>
              )}
              {effects.length > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: "#5b616e", lineHeight: 1.45 }}>
                  {effects.map((line, i) => (
                    <li key={i + ":" + line} style={{ overflowWrap: "anywhere" }}>
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {!plan.noop && (
              <button type="button" onClick={runMove} disabled={busy} style={{ ...PRIMARY, ...(busy ? { opacity: 0.6, cursor: "default" } : null) }}>
                {busy ? "Moving…" : "Move"}
              </button>
            )}
            <button type="button" onClick={close} disabled={!!waiting} style={{ ...BTN, ...(waiting ? { opacity: 0.6, cursor: "default" } : null) }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

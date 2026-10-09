"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { trayFootnote, trayRows, type TrayRow } from "@/lib/design/estimate-tray";
import { GRID_LINK_COPY } from "@/lib/design/estimate-grid-link";
import { SymbolIcon } from "@/components/design/symbol-shape";
import { ObjectSymbolImg } from "@/components/design/object-symbol";
import { syncEstimatePartsAction } from "../actions";
import { GRID_PART_MIME } from "../plan-canvas";
import type { GridEditor } from "../use-grid-editor";

/**
 * #314 — the Product Library's "From estimate" tab: every placeable BOM line
 * of the estimate this design draws, with placed / needed counts. Click a row
 * to arm Place (the same painter tool the library tiles use — click the plan
 * for each unit, Esc stops) or drag it onto the plan. Nothing is ever placed
 * for you. The counts are recomputed from the option's live placements after
 * every place (trayRows), so "remaining" goes down as you work. Alternates
 * and add-options sit in their own collapsed list.
 */

const ROW: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "34px minmax(0,1fr) auto",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "5px 8px",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#e4e7ec",
  borderRadius: 8,
  background: "#fff",
  fontFamily: "inherit",
  textAlign: "left",
  cursor: "pointer",
};

function rowStyle(on: boolean, disabled: boolean): React.CSSProperties {
  if (disabled) return { ...ROW, cursor: "not-allowed", opacity: 0.6 };
  return on ? { ...ROW, borderColor: "var(--accent)", boxShadow: "inset 0 0 0 1px var(--accent)" } : ROW;
}

function Count({ r }: { r: TrayRow }) {
  const done = r.remaining === 0;
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1, fontVariantNumeric: "tabular-nums" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: done ? "#2e7d55" : "#16181d" }}>
        {Math.min(r.placed, r.needed)} / {r.needed}
      </span>
      <span style={{ fontSize: 10.5, color: r.overBy ? "#a0442b" : done ? "#2e7d55" : "#8c919c", fontWeight: r.overBy ? 600 : 400 }}>
        {r.overBy ? `${r.overBy} over` : done ? "all placed" : `${r.remaining} to place`}
      </span>
    </span>
  );
}

export default function EstimateTray({ ed }: { ed: GridEditor }) {
  const { estimateTray, placements, parts, armedPartId, enterTool, disarm, lookOf, symbolUrls, project, router, canCreate } = ed;
  const [altOpen, setAltOpen] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, startSync] = useTransition();
  const byId = useMemo(() => new Map(parts.map((p) => [p.id, p] as const)), [parts]);
  const view = useMemo(
    () => (estimateTray ? trayRows(estimateTray.lines, placements, estimateTray.renames) : null),
    [estimateTray, placements]
  );
  if (!estimateTray || !view) return null;

  if (estimateTray.gone) {
    return <div style={{ fontSize: 12, color: "#a0442b", padding: 4 }}>{GRID_LINK_COPY.gone} The tray is empty; the drawings stay.</div>;
  }

  const missing = [...view.main, ...view.alternates].filter((r) => !byId.has(r.sku));
  const sync = () =>
    startSync(async () => {
      setSyncMsg(null);
      try {
        const r = await syncEstimatePartsAction(project.id);
        if (!r.ok) setSyncMsg(r.error);
        else {
          setSyncMsg(r.added ? `Added ${r.added} part${r.added === 1 ? "" : "s"} to the Grid library.` : "Nothing to add.");
          router.refresh();
        }
      } catch {
        setSyncMsg("That didn't save — check your connection and try again.");
      }
    });

  const renderRow = (r: TrayRow) => {
    const part = byId.get(r.sku);
    const on = !!part && armedPartId === r.sku;
    const look = part ? lookOf(part) : null;
    const drawing = part ? symbolUrls[part.id]?.plan : undefined;
    return (
      <li key={r.sku} style={{ listStyle: "none" }}>
        <button
          type="button"
          draggable={!!part}
          disabled={!part}
          onDragStart={(e) => {
            if (!part) return;
            e.dataTransfer.setData(GRID_PART_MIME, part.id);
            e.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => (on ? disarm() : part && enterTool("place", { partId: part.id }))}
          aria-pressed={on}
          title={part ? `${r.label} — click, then click the plan for each unit` : "Not in the Grid library yet — use Sync parts below."}
          style={rowStyle(on, !part)}
        >
          <span style={{ display: "flex", justifyContent: "center" }}>
            {look ? (
              drawing ? (
                <ObjectSymbolImg src={drawing} size={26} fallback={<SymbolIcon iconId={look.iconId} color={look.color} size={26} />} />
              ) : (
                <SymbolIcon iconId={look.iconId} color={look.color} size={26} />
              )
            ) : (
              <span style={{ fontSize: 16, color: "#b7bcc6" }}>?</span>
            )}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 12, color: "#16181d", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
            <span style={{ display: "block", fontSize: 10.5, color: "#8c919c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {[r.model, r.sku].filter(Boolean).join(" · ")}
            </span>
          </span>
          <Count r={r} />
        </button>
      </li>
    );
  };

  const foot = trayFootnote(estimateTray);
  const t = view.totals;
  return (
    <div data-testid="estimate-tray" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", fontSize: 11.5, color: "#5b616e" }}>
        <span>
          <strong style={{ color: "#16181d" }}>From estimate {estimateTray.quoteNumber}</strong> · {t.placed} of {t.needed} placed
          {t.remaining ? ` · ${t.remaining} to go` : t.needed ? " · all placed" : ""}
        </span>
        <Link href={estimateTray.href} style={{ color: "var(--accent)", fontWeight: 600 }}>
          {GRID_LINK_COPY.openEstimate}
        </Link>
      </div>
      {view.main.length === 0 && view.alternates.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>Nothing on this estimate to place yet. Add parts in the Estimator, then reload.</div>
      ) : (
        <ul style={{ margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 6 }}>{view.main.map(renderRow)}</ul>
      )}
      {view.alternates.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setAltOpen((v) => !v)}
            aria-expanded={altOpen}
            style={{ border: "none", background: "none", padding: "2px 0", fontFamily: "inherit", fontSize: 11.5, fontWeight: 600, color: "#3d424e", cursor: "pointer" }}
          >
            {altOpen ? "▾" : "▸"} Alternates &amp; options ({view.alternates.length})
          </button>
          {altOpen && (
            <ul style={{ margin: "4px 0 0", padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 6 }}>{view.alternates.map(renderRow)}</ul>
          )}
        </div>
      )}
      {view.extras.length > 0 && (
        <div style={{ fontSize: 10.5, color: "#8c919c", lineHeight: 1.45 }}>
          On the plan but not on the estimate: {view.extras.slice(0, 6).map((x) => `${x.sku} × ${x.placed}`).join(", ")}
          {view.extras.length > 6 ? ` +${view.extras.length - 6} more` : ""}. Drawings only — the estimate&apos;s parts and prices don&apos;t change.
        </div>
      )}
      {missing.length > 0 && (
        <div style={{ fontSize: 10.5, color: "#8a6d1f", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>
            {missing.length} part{missing.length === 1 ? " isn't" : "s aren't"} in the Grid library yet.
          </span>
          {canCreate && (
            <button type="button" onClick={sync} disabled={syncing} style={{ border: "1px solid #dfe2e8", background: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 600, cursor: syncing ? "wait" : "pointer" }}>
              {syncing ? "Syncing…" : "Sync parts"}
            </button>
          )}
        </div>
      )}
      {syncMsg && <div style={{ fontSize: 10.5, color: "#5b616e" }}>{syncMsg}</div>}
      {foot && <div style={{ fontSize: 10.5, color: "#9aa0ab" }}>{foot}</div>}
    </div>
  );
}

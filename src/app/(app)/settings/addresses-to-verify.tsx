"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VerifyKind, VerifyList, VerifyRow, VerifyStatusFilter } from "@/lib/address-verify/types";
import AddressFixDrawer from "@/components/address-fix/address-fix-drawer";
import { listAddressesToVerifyAction } from "../address-actions";

/**
 * Settings → Data — Addresses to verify (spec 2026-10-09), grown from the
 * #175 unlocated-venues worklist: venues, upcoming site visits and open
 * leads whose address isn't verified. Live query; rows leave as they're fixed.
 */
const PAGE = 50;
const KINDS: Array<{ key: VerifyKind | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "visit", label: "Visits" },
  { key: "lead", label: "Leads" },
  { key: "venue", label: "Venues" },
];
const STATUS_LABEL: Record<string, string> = { needs_check: "Needs check", unresolved: "Unresolved" };

export default function AddressesToVerify({
  reasons,
  refreshKey,
  onChanged,
}: {
  /** Batch-geocoder failure reasons, keyed by venue site id. */
  reasons: Record<string, string>;
  refreshKey: number;
  onChanged: () => void;
}) {
  const [list, setList] = useState<VerifyList | null>(null);
  const [rows, setRows] = useState<VerifyRow[]>([]);
  const [kind, setKind] = useState<VerifyKind | "all">("all");
  const [status, setStatus] = useState<VerifyStatusFilter>("unverified");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<{ row: VerifyRow; idx: number; fixed: boolean } | null>(null);
  // Only the latest request may write state (fast filter/search changes).
  const seq = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      const mine = ++seq.current;
      setLoading(true);
      setError("");
      try {
        const r = await listAddressesToVerifyAction({ kind, status, q, offset, limit: PAGE });
        if (mine !== seq.current) return;
        setList(r);
        setRows((prev) => (offset ? [...prev, ...r.rows] : r.rows));
      } catch (e) {
        if (mine === seq.current) setError(e instanceof Error ? e.message : "Could not load the list");
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [kind, status, q]
  );

  useEffect(() => {
    const t = setTimeout(() => void load(0), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q, refreshKey]);

  /** Two rows are the same address when they open the same Fix target. */
  const fixKey = (r: VerifyRow) => (r.fix.kind === "venue" ? "venue:" + r.fix.siteId : "place:" + r.fix.key);

  // A verified address leaves EVERY row that shares it (one place-book key
  // can sit under several visits and leads), so "Show more" offsets stay
  // right and "Next address →" never opens an already-verified row.
  function removeFixed(fixed: VerifyRow) {
    const k = fixKey(fixed);
    const gone = rows.filter((r) => fixKey(r) === k);
    const goneIds = new Set(gone.map((r) => r.id));
    // The next row's new index = the rows that survive before the opened one.
    const at = open ? rows.slice(0, open.idx).filter((r) => !goneIds.has(r.id)).length : 0;
    setRows(rows.filter((r) => !goneIds.has(r.id)));
    setList((l) => {
      if (!l) return l;
      const counts = { ...l.counts };
      for (const r of gone) counts[r.kind] = Math.max(0, counts[r.kind] - 1);
      return { ...l, total: Math.max(0, l.total - gone.length), counts };
    });
    setOpen((o) => (o && o.row.id === fixed.id ? { ...o, idx: at, fixed: true } : o));
    onChanged();
  }

  // After a fix the fixed row is gone, so the next one sits at the same index.
  const nextRow = open ? rows[open.fixed ? open.idx : open.idx + 1] : undefined;
  const reasonFor = (r: VerifyRow) => (r.fix.kind === "venue" ? reasons[r.fix.siteId] : undefined);

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {list ? (
            <>
              Addresses to verify · {list.total.toLocaleString()}
              <span style={{ fontWeight: 400, color: "#9aa0ab" }}> · {list.noAddress.toLocaleString()} venues have no address at all</span>
            </>
          ) : (
            "Loading addresses…"
          )}
        </div>
        <div role="group" aria-label="Show" style={{ display: "flex", border: "1px solid #e4e7ec", borderRadius: 8, overflow: "hidden" }}>
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              aria-pressed={kind === k.key}
              className={kind === k.key ? "pk-btn-accent" : "pk-btn-outline"}
              style={{ fontSize: 12, padding: "4px 10px", border: "none", borderRadius: 0 }}
              onClick={() => setKind(k.key)}
            >
              {k.label}
              {list && k.key !== "all" ? ` (${list.counts[k.key]})` : ""}
            </button>
          ))}
        </div>
        <select
          className="pk-input"
          aria-label="Status"
          style={{ fontSize: 12.5, width: 150 }}
          value={status}
          onChange={(e) => setStatus(e.target.value as VerifyStatusFilter)}
        >
          <option value="unverified">All unverified</option>
          <option value="needs_check">Needs check</option>
          <option value="unresolved">Unresolved</option>
        </select>
        <input
          className="pk-input"
          aria-label="Search name or address"
          style={{ marginLeft: "auto", width: 220, maxWidth: "100%", fontSize: 12.5 }}
          placeholder="Search name or address"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {error && <div style={{ marginTop: 6, fontSize: 12, color: "#8a3a2a" }}>{error}</div>}
      {list && rows.length === 0 && !loading && !error && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: "#5d636e" }}>Nothing to verify here.</div>
      )}
      {rows.length > 0 && (
        <div style={{ marginTop: 8, border: "1px solid #ececf0", borderRadius: 8, overflow: "hidden" }}>
          {rows.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setOpen({ row: r, idx: i, fixed: false })}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1.4fr) minmax(0,0.8fr)",
                gap: 10,
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                border: 0,
                borderTop: i ? "1px solid #f3f4f7" : 0,
                background: open?.row.id === r.id ? "#f6f7fb" : "#fff",
                cursor: "pointer",
                fontSize: 12.5,
                color: "#16181d",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <strong style={{ fontWeight: 600 }}>{r.title}</strong>
                <span style={{ color: "#9aa0ab" }}> · {r.sub}</span>
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#5d636e" }}>{r.address}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#8a3a2a" }}>
                {reasonFor(r) || (r.checked ? STATUS_LABEL[r.status] : "Not checked yet")}
              </span>
            </button>
          ))}
        </div>
      )}
      {list && rows.length < list.total && (
        <button type="button" className="pk-btn-outline" style={{ marginTop: 6, fontSize: 12 }} disabled={loading} onClick={() => void load(rows.length)}>
          {loading ? "Loading…" : `Show more (${(list.total - rows.length).toLocaleString()} left)`}
        </button>
      )}
      {open && (
        <AddressFixDrawer
          key={open.row.id}
          target={open.row.fix}
          reason={reasonFor(open.row)}
          hasNext={!!nextRow}
          onNext={() => nextRow && setOpen({ row: nextRow, idx: rows.indexOf(nextRow), fixed: false })}
          onClose={() => setOpen(null)}
          onFixed={(s) => {
            if (s === "verified") removeFixed(open.row);
          }}
          onGone={() => removeFixed(open.row)}
        />
      )}
    </div>
  );
}

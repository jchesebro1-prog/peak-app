"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UnlocatedVenue } from "@/lib/venue-locate";
import { listUnlocatedVenuesAction } from "./actions";
import VenueLocateDrawer from "./venue-locate-drawer";

/**
 * Settings → Admin worklist of venues that can't be located (#169, D225).
 * A live query (see lib/venue-locate.ts), so it survives reloads and shrinks
 * as venues are fixed. Clicking a row opens the fix-it sidebar.
 */

const PAGE = 50;

export default function UnlocatedVenues({
  reasons,
  refreshKey,
  onChanged,
}: {
  reasons: Record<string, string>;
  refreshKey: number;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<UnlocatedVenue[]>([]);
  const [total, setTotal] = useState(0);
  const [noAddress, setNoAddress] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // True once the first load has resolved, so the header doesn't misreport
  // "0 venues" before the counts are real (#169 review).
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<{ venue: UnlocatedVenue; idx: number; located: boolean } | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (query: string, offset: number) => {
    const mine = ++seq.current;
    setLoading(true);
    setError("");
    try {
      const r = await listUnlocatedVenuesAction({ q: query, offset, limit: PAGE });
      if (mine !== seq.current) return;
      setRows((prev) => (offset ? [...prev, ...r.rows] : r.rows));
      setTotal(r.total);
      setNoAddress(r.noAddress);
      setLoaded(true);
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : "Could not load the list");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  // Initial load, after every batch run (refreshKey), and on search (debounced).
  useEffect(() => {
    const t = setTimeout(() => void load(q, 0), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, refreshKey, load]);

  // Removes a row that's no longer a worklist candidate — fixed, or deleted
  // out from under us (`onGone`, #169 review: same list bookkeeping either
  // way, and `open.located` only ever drives the Next-index math below, not
  // any ✓ display — that lives in the drawer's own `done` state).
  function located(siteId: string) {
    setRows((prev) => prev.filter((r) => r.siteId !== siteId));
    setTotal((t) => Math.max(0, t - 1));
    setOpen((o) => (o && o.venue.siteId === siteId ? { ...o, located: true } : o));
    onChanged();
  }

  // After a fix the row is gone, so the next venue has slid into its index.
  const nextVenue = open ? rows[open.located ? open.idx : open.idx + 1] : undefined;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {error ? null : !loaded ? (
            "Loading venues…"
          ) : (
            <>
              {total.toLocaleString()} venue{total === 1 ? "" : "s"} can’t be located
              <span style={{ fontWeight: 400, color: "#9aa0ab" }}>
                {" "}· {noAddress.toLocaleString()} have no address at all
              </span>
            </>
          )}
        </div>
        <input
          className="pk-input"
          style={{ marginLeft: "auto", width: 220, fontSize: 12.5 }}
          placeholder="Search company, venue, street, city"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {error && <div style={{ marginTop: 6, fontSize: 12, color: "#8a3a2a" }}>{error}</div>}
      {rows.length > 0 && (
        <div style={{ marginTop: 8, border: "1px solid #ececf0", borderRadius: 8, overflow: "hidden" }}>
          {rows.map((r, i) => {
            const why = reasons[r.siteId];
            return (
              <button
                key={r.siteId}
                type="button"
                onClick={() => setOpen({ venue: r, idx: i, located: false })}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1.4fr) minmax(0,1fr)",
                  gap: 10,
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  border: 0,
                  borderTop: i ? "1px solid #f3f4f7" : 0,
                  background: open?.venue.siteId === r.siteId ? "#f6f7fb" : "#fff",
                  cursor: "pointer",
                  fontSize: 12.5,
                  color: "#16181d",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <strong style={{ fontWeight: 600 }}>{r.companyName}</strong>
                  <span style={{ color: "#9aa0ab" }}> · {r.venueName || "Untitled venue"}</span>
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#5d636e" }}>
                  {[r.address, [r.city, [r.state, r.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#8a3a2a" }}>
                  {why || ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {rows.length < total && (
        <button
          type="button"
          className="pk-btn-quiet"
          style={{ marginTop: 6, fontSize: 12 }}
          disabled={loading}
          onClick={() => void load(q, rows.length)}
        >
          {loading ? "Loading…" : `Show more (${(total - rows.length).toLocaleString()} left)`}
        </button>
      )}
      {open && (
        <VenueLocateDrawer
          key={open.venue.siteId}
          venue={open.venue}
          reason={reasons[open.venue.siteId]}
          hasNext={!!nextVenue}
          onNext={() => {
            if (!nextVenue) return;
            setOpen({ venue: nextVenue, idx: rows.indexOf(nextVenue), located: false });
          }}
          onClose={() => setOpen(null)}
          onLocated={located}
          onGone={located}
        />
      )}
    </div>
  );
}

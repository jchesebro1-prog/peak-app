/**
 * Estimator handoff — the Estimates list: a slim rebuild of the Quotes hub (src/app/(app)/quotes/page.tsx) for system
 * estimates only. Columns: estimate # (displayQuoteNumber), name, customer, status, owner, updated, grand total (the
 * figure the Estimator's header shows — runtime/estimate-totals.ts). Search, status filter, newest first, and a
 * "New estimate" button for anyone holding `create`. Plan: PR 2 Task 7.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusPill, QUOTE_STATUS_TONE } from "@/components/ui";
import { appRouter } from "../shims/next-navigation";
import { onRefresh } from "../runtime/router";
import { blobData, customers, refreshPortsFromStore, users } from "../runtime/ports";
import type { HandoffStore } from "../runtime/store";
import { filterRows, listRows, STATUS_FILTER_LABEL, STATUS_FILTERS, STATUS_LABEL, statusCounts, updatedLabel, type ListQuote, type ListRow, type StatusFilter } from "../runtime/estimates-list-model";

export const LIST_COPY = {
  title: "Estimates",
  newEstimate: "New estimate",
  searchPlaceholder: "Search # · name · customer · owner",
  empty: "No estimates match.",
  none: "There are no estimates in this snapshot yet.",
} as const;

const TH = { textAlign: "left", fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#8c919c", padding: "10px 12px", borderBottom: "1px solid #ececf0", whiteSpace: "nowrap" } as const;
const TD = { padding: "11px 12px", borderBottom: "1px solid #f1f2f5", fontSize: 13, verticalAlign: "middle" } as const;

export function EstimatesList({ store, onReady }: { store: HandoffStore; onReady: () => void }) {
  const [rows, setRows] = useState<ListRow[] | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [term, setTerm] = useState("");
  const canCreate = users.can("create");

  const load = useCallback(async () => {
    const quotes = await store.all<ListQuote>("quotes");
    // The bonus rates as the store holds them (an Estimating Rules edit), not a stale snapshot.
    await refreshPortsFromStore(store);
    const general = blobData("pricing_rules");
    return listRows(quotes, general, (q) => customers.resolve(q.customerId || q.customer)?.name ?? q.customer ?? "");
  }, [store]);

  useEffect(() => {
    let alive = true;
    const run = () =>
      load().then(
        (r) => alive && setRows(r),
        (e: unknown) => console.error("[handoff] estimates list: could not read the estimates", e),
      );
    void run();
    const off = onRefresh(() => void run());
    window.addEventListener("focus", run);
    return () => {
      alive = false;
      off();
      window.removeEventListener("focus", run);
    };
  }, [load]);

  useEffect(() => {
    if (rows) onReady();
  }, [rows, onReady]);

  const counts = useMemo(() => statusCounts(rows ?? []), [rows]);
  const shown = useMemo(() => filterRows(rows ?? [], status, term), [rows, status, term]);
  const open = (id: string) => appRouter.push(`/estimator?id=${encodeURIComponent(id)}`);

  return (
    <div className="pk-content" data-handoff-list="" style={{ padding: "22px 24px", overflow: "auto", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>{LIST_COPY.title}</div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>{rows ? `${rows.length} system ${rows.length === 1 ? "estimate" : "estimates"}` : "Loading…"}</div>
        </div>
        {canCreate && (
          <button type="button" className="pk-btn-accent" data-handoff-new-estimate="" onClick={() => appRouter.push("/estimator?new=1")}>
            {LIST_COPY.newEstimate}
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div role="group" aria-label="Status" style={{ display: "flex", background: "#f1f2f5", borderRadius: 8, padding: 2, maxWidth: "100%", overflowX: "auto" }}>
          {STATUS_FILTERS.map((key) => {
            const active = status === key;
            return (
              <button
                key={key}
                type="button"
                data-handoff-list-filter={key}
                aria-pressed={active}
                onClick={() => setStatus(key)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", padding: "7px 12px", borderRadius: 7, border: "none", cursor: "pointer",
                  ...(active ? { background: "#fff", color: "#16181d", boxShadow: "0 1px 2px rgba(0,0,0,.08)" } : { background: "transparent", color: "#787d87" }),
                }}
              >
                {STATUS_FILTER_LABEL[key]}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, color: active ? "var(--accent)" : "#aab0bb" }}>{counts[key]}</span>
              </button>
            );
          })}
        </div>
        <input
          type="search"
          className="pk-input"
          data-handoff-list-search=""
          aria-label="Search estimates by number, name, customer or owner"
          placeholder={LIST_COPY.searchPlaceholder}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          style={{ fontSize: 12.5, padding: "6px 10px", minWidth: 0, width: 300, maxWidth: "100%" }}
        />
      </div>

      <div style={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
          <thead>
            <tr>
              <th style={TH}>Estimate #</th>
              <th style={TH}>Name</th>
              <th style={TH}>Customer</th>
              <th style={{ ...TH, textAlign: "center" }}>Status</th>
              <th style={TH}>Owner</th>
              <th style={TH}>Updated</th>
              <th style={{ ...TH, textAlign: "right" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.id}
                data-estimate-id={r.id}
                onClick={(e) => {
                  // The name link routes itself (ui/link-routing.ts, after this handler) — one history entry per click.
                  if ((e.target as Element).closest("a")) return;
                  open(r.id);
                }}
                style={{ cursor: "pointer" }}
              >
                <td data-col="number" style={{ ...TD, fontFamily: "var(--font-mono)", fontSize: 12, color: "#5b616e", whiteSpace: "nowrap" }}>{r.number}</td>
                <td data-col="name" style={{ ...TD, fontWeight: 600, maxWidth: 320 }}>
                  <a href={`#/estimate/${encodeURIComponent(r.id)}`} style={{ color: "inherit", textDecoration: "none" }}>{r.name}</a>
                </td>
                <td data-col="customer" style={{ ...TD, color: "#5b616e", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.customer || "—"}</td>
                <td data-col="status" style={{ ...TD, textAlign: "center" }}>
                  <StatusPill tone={QUOTE_STATUS_TONE[r.status] || "gray"} minWidth={64}>{STATUS_LABEL[r.status]}</StatusPill>
                </td>
                <td data-col="owner" style={{ ...TD, color: "#5b616e", whiteSpace: "nowrap" }}>{r.owner || "—"}</td>
                <td data-col="updated" style={{ ...TD, color: "#5b616e", whiteSpace: "nowrap" }}>{updatedLabel(r.updatedAt)}</td>
                <td data-col="total" style={{ ...TD, fontFamily: "var(--font-mono)", fontWeight: 600, textAlign: "right", whiteSpace: "nowrap" }}>{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && shown.length === 0 && (
          <div data-handoff-list-empty="" style={{ padding: "28px 16px", textAlign: "center", color: "#8c919c", fontSize: 13 }}>
            {rows.length === 0 ? LIST_COPY.none : LIST_COPY.empty}
          </div>
        )}
      </div>
    </div>
  );
}

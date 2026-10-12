import Link from "next/link";
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getAll } from "@/lib/stores/quotes";
import { quoteBuilderHref } from "@/lib/quote-links";
import { bonusReportRange, bonusReportRows, chicagoDay, type BonusReportRow } from "@/lib/estimate-bonus/report";

export const metadata = { title: "Estimator bonuses — Quartzite-6" };

/**
 * Estimator bonuses (Reports): every credit written when an Estimator
 * estimate was marked Won, by person and month. Admins (manage_users) see
 * everyone and can filter to one person; everyone else sees only their own.
 */

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const CSS = `
  .eb-grid { display: grid; grid-template-columns: 92px minmax(0,1.5fr) minmax(0,1.2fr) 96px 84px 64px 112px 100px; gap: 10px; align-items: center; }
  .eb-row:hover { background: #fafbff; }
  @media (max-width: 860px) {
    .eb-grid { grid-template-columns: 92px minmax(0,1.5fr) 100px; }
    .eb-wide { display: none !important; }
  }
`;

/** Module-level so the clock read stays out of the component body (react-hooks/purity). */
function rangeFor(from: string, to: string) {
  return bonusReportRange(from, to, Date.now());
}

const th: CSSProperties = { fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em" };
const cell: CSSProperties = { fontSize: 12.5, color: "#3a3f4a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const mono: CSSProperties = { fontFamily: "var(--font-mono)" };
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function EstimatorBonusesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [me, sp] = await Promise.all([requireUser(), searchParams]);
  const isAdmin = can("manage_users", me.roles);
  const range = rangeFor(one(sp.from), one(sp.to));
  const personParam = isAdmin ? one(sp.person).trim() : "";

  const quotes = (await getAll()).filter((q) => q.status === "won");
  const viewer = { id: me.id, name: me.name, isAdmin };
  const inRange = bonusReportRows(quotes, viewer, { from: range.from, to: range.to });
  const rows = personParam ? inRange.filter((r) => r.person.toLowerCase() === personParam.toLowerCase()) : inRange;
  const people = [...new Set(inRange.map((r) => r.person))];

  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ from: range.fromDay, to: range.toDay, ...extra });
    return p.toString();
  };
  const exportHref = `/reports/estimator-bonuses/export?${qs(personParam ? { person: personParam } : {})}`;

  const byPerson = new Map<string, BonusReportRow[]>();
  for (const r of rows) byPerson.set(r.person, [...(byPerson.get(r.person) ?? []), r]);
  const total = rows.reduce((s, r) => s + r.amount, 0);

  const chip = (label: string, href: string, on: boolean) => (
    <Link
      key={label}
      href={href}
      style={{
        fontSize: 12,
        fontWeight: 600,
        padding: "6px 11px",
        borderRadius: 20,
        textDecoration: "none",
        color: on ? "#fff" : "#3a3f4a",
        background: on ? "#3a3f4a" : "#fff",
        border: `1px solid ${on ? "#3a3f4a" : "#e4e7ec"}`,
      }}
    >
      {label}
    </Link>
  );

  return (
    <div className="pk-content" style={{ maxWidth: 1080, margin: "0 auto" }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Estimator bonuses</span>
          <span style={{ ...mono, fontSize: 13, color: "#9aa0ab" }}>{money(total)}</span>
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <Link href={exportHref} prefetch={false} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
            Download CSV
          </Link>
          <Link href="/reports" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
            ← Reports
          </Link>
        </div>
      </div>

      <form method="get" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12, fontSize: 12.5 }}>
        <label>
          From <input type="date" name="from" defaultValue={range.fromDay} style={{ marginLeft: 4 }} />
        </label>
        <label>
          To <input type="date" name="to" defaultValue={range.toDay} style={{ marginLeft: 4 }} />
        </label>
        {personParam ? <input type="hidden" name="person" value={personParam} /> : null}
        <button type="submit" className="pk-btn">Apply</button>
      </form>

      {isAdmin && people.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {chip("Everyone", `/reports/estimator-bonuses?${qs({})}`, !personParam)}
          {people.map((p) => chip(p, `/reports/estimator-bonuses?${qs({ person: p })}`, personParam.toLowerCase() === p.toLowerCase()))}
        </div>
      )}
      {!isAdmin && (
        <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 12 }}>Showing your credits only.</div>
      )}

      <div className="pk-card" style={{ padding: 0, overflow: "hidden", marginBottom: 18 }}>
        <div className="eb-grid" style={{ padding: "9px 18px", background: "#fafbfc", borderBottom: "1px solid #f0f1f4" }}>
          <span style={th}>Estimate #</span>
          <span style={th}>Estimate</span>
          <span className="eb-wide" style={th}>Customer</span>
          <span className="eb-wide" style={th}>Won</span>
          <span className="eb-wide" style={th}>Role</span>
          <span className="eb-wide" style={{ ...th, textAlign: "right" }}>Split</span>
          <span className="eb-wide" style={{ ...th, textAlign: "right" }}>Estimate total</span>
          <span style={{ ...th, textAlign: "right" }}>Bonus</span>
        </div>
        {rows.length === 0 ? (
          <div style={{ padding: "20px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            No bonus credits in this date range.
          </div>
        ) : (
          [...byPerson.entries()].map(([person, list]) => {
            const byMonth = new Map<string, BonusReportRow[]>();
            for (const r of list) byMonth.set(r.month, [...(byMonth.get(r.month) ?? []), r]);
            return (
              <div key={person}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "11px 18px", background: "#f5f6f8", borderBottom: "1px solid #eceef2", fontSize: 13.5, fontWeight: 600 }}>
                  <span>{person}</span>
                  <span style={mono}>{money(list.reduce((s, r) => s + r.amount, 0))}</span>
                </div>
                {[...byMonth.entries()].map(([month, mrows]) => (
                  <div key={month}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 18px", borderBottom: "1px solid #f5f6f8", fontSize: 11.5, color: "#8c919c" }}>
                      <span style={mono}>{month}</span>
                      <span style={mono}>{money(mrows.reduce((s, r) => s + r.amount, 0))}</span>
                    </div>
                    {mrows.map((r, i) => (
                      <Link
                        key={`${r.quoteId}-${r.role}-${i}`}
                        // Only system quotes carry a bonus record (isBonusEligibleQuote), so every row opens the Estimator.
                        href={quoteBuilderHref({ id: r.quoteId, quoteType: "system" })}
                        className="eb-grid eb-row"
                        style={{ padding: "10px 18px", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" }}
                      >
                        <span style={{ ...cell, ...mono }}>{r.number}</span>
                        <span style={cell}>{r.name}</span>
                        <span className="eb-wide" style={cell}>{r.customer}</span>
                        <span className="eb-wide" style={{ ...cell, ...mono }}>{chicagoDay(r.wonAt)}</span>
                        <span className="eb-wide" style={cell}>{r.role === "lead" ? "Lead" : "Prepared by"}</span>
                        <span className="eb-wide" style={{ ...cell, ...mono, textAlign: "right" }}>{r.pct}%</span>
                        <span className="eb-wide" style={{ ...cell, ...mono, textAlign: "right" }}>{money(r.sellTotal)}</span>
                        <span style={{ ...cell, ...mono, textAlign: "right", fontWeight: 600 }}>{money(r.amount)}</span>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

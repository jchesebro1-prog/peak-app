import Link from "next/link";
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { getAll as allLeads } from "@/lib/stores/leads";
import { getAll as allQuotes } from "@/lib/stores/quotes";
import { companyFacts } from "@/lib/stores/customers";
import {
  OPP_COLUMNS,
  buildOpportunities,
  allowedMoves,
  applyOppFilters,
  openTotals,
  ageLabel,
  type OppFilters,
  type OppRow,
} from "@/lib/opportunities";
import { CUSTOMER_TYPES } from "../companies/lib";
import { avatarFor, type Ident } from "../leads/lib";
import { shortMoneyZero } from "../leads/money";
import { OwnerSelect } from "../quotes/controls";
import BoardView from "@/components/board/board-view";
import type { BoardCardVM, BoardColumnVM, ChipVM } from "@/components/board/types";
import { moveOpportunityAction } from "./actions";
import { KwInput } from "./controls";

/**
 * Opportunities (#18) — Daylite's merged pipeline as a READ-TIME UNION over
 * leads + quotes (D119; no Opportunity record, no migration). Six bid-stage
 * columns; lead cards until conversion, then the quote carries the card.
 * Filters are URL params (default-stripped, allowlist-validated); every drag
 * dispatches moveOpportunityAction, which re-validates server-side.
 */

export const metadata = { title: "Opportunities — Quartzite-6" };

const CREATED_KEYS = ["7d", "30d", "90d"] as const;
const FORECAST_KEYS = ["30d", "90d", "past"] as const;

const styleBlock = `
.lv-hs::-webkit-scrollbar { height: 9px; }
.lv-hs::-webkit-scrollbar-thumb { background: #d3d6dd; border-radius: 8px; }
.lv-col::-webkit-scrollbar { width: 7px; }
.lv-col::-webkit-scrollbar-thumb { background: #dcdfe5; border-radius: 8px; }
.lv-bcard:hover { border-color: #c9ccd4; box-shadow: 0 3px 10px rgba(16,18,22,.09); }
/* copied from quotes/page.tsx — select.qt-sel's dropdown-arrow rule, so OwnerSelect renders identically here */
select.qt-sel { -webkit-appearance: none; appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%238c919c' stroke-width='1.5'/></svg>"); background-repeat: no-repeat; background-position: right 11px center; }
`;

const segBase: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  padding: "7px 13px",
  borderRadius: 7,
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const chipStyle = (on: boolean): CSSProperties => ({
  fontSize: 11.5,
  fontWeight: 600,
  whiteSpace: "nowrap",
  padding: "6px 12px",
  borderRadius: 20,
  textDecoration: "none",
  border: `1px solid ${on ? "var(--accent)" : "#e4e7ec"}`,
  background: on ? "var(--accent-soft)" : "#fff",
  color: on ? "color-mix(in srgb, var(--accent) 70%, #000)" : "#787d87",
});

const groupLbl: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#aab0bb",
  marginLeft: 4,
};

const L_CHIP: ChipVM = { label: "L", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" };
const Q_CHIP: ChipVM = { label: "Q", ink: "#5b4b8a", soft: "#efeaf6", bd: "#ddd4ec" };
const WON_CHIP: ChipVM = { label: "Won", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" };
const LOST_CHIP: ChipVM = { label: "Lost", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec" };

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";

  const [leads, quotes, facts, users] = await Promise.all([
    allLeads(),
    allQuotes(),
    companyFacts(),
    activeUsers(),
  ]);
  const roster: Ident[] = users.map((u) => ({ name: u.name, initials: u.initials, color: u.color }));

  /* ---- URL params (default-stripped, allowlist-validated) ---- */
  const whoRaw = one(sp.who);
  const scope =
    !whoRaw || whoRaw === "all" ? "all" : whoRaw === "mine" || whoRaw === me.name ? "mine" : whoRaw;
  const created = (CREATED_KEYS as readonly string[]).includes(one(sp.created))
    ? (one(sp.created) as OppFilters["created"])
    : "";
  const forecast = (FORECAST_KEYS as readonly string[]).includes(one(sp.forecast))
    ? (one(sp.forecast) as OppFilters["forecast"])
    : "";
  const kw = one(sp.kw).trim();
  const vt = (CUSTOMER_TYPES as readonly string[]).includes(one(sp.vt)) ? one(sp.vt) : "";

  const hrefFor = (over: Partial<{ who: string; created: string; forecast: string; kw: string; vt: string }>) => {
    const p = new URLSearchParams();
    const w = over.who ?? (scope === "all" ? "all" : scope);
    if (w && w !== "all") p.set("who", w);
    const c = over.created ?? created;
    if (c) p.set("created", c);
    const fc = over.forecast ?? forecast;
    if (fc) p.set("forecast", fc);
    const k = over.kw ?? kw;
    if (k) p.set("kw", k);
    const v = over.vt ?? vt;
    if (v) p.set("vt", v);
    const s = p.toString();
    return "/opportunities" + (s ? "?" + s : "");
  };

  /* ---- union + filters + totals ---- */
  const rows = buildOpportunities(
    leads.map((l) => ({
      id: l.id,
      org: l.org,
      interest: l.interest || "New enquiry",
      stage: l.stage,
      owner: l.owner || "",
      value: l.value || 0,
      createdAt: l.createdAt || 0,
      updatedAt: l.updatedAt || 0,
      customerId: l.customerId ?? null,
      convertedCustomerId: l.convertedCustomerId ?? null,
      convertedQuoteId: l.convertedQuoteId ?? null,
      forecastAt: l.forecastAt ?? null,
    })),
    quotes.map((q) => ({
      id: q.id,
      name: q.name,
      customer: q.customer || "",
      status: q.status,
      owner: q.owner || "",
      value: q.value || 0,
      createdAt: q.createdAt || 0,
      updatedAt: q.updatedAt || 0,
      customerId: q.customerId ?? null,
      poReceivedAt: q.poReceivedAt ?? null,
    }))
  );

  const nowMs = Date.now();
  const who = scope === "all" ? "" : scope === "mine" ? me.name : scope;
  const filtered = applyOppFilters(rows, { who, created, forecast, kw, vt }, facts, nowMs);

  const tot = openTotals(filtered);
  const standfirst = `${tot.count} opportunities • $${Math.round(tot.value).toLocaleString("en-US")} open pipeline`;

  /* ---- board VMs (pre-sorted updatedAt-desc) ---- */
  const cardOf = (r: OppRow): BoardCardVM => {
    const chips: ChipVM[] = [r.kind === "lead" ? L_CHIP : Q_CHIP];
    if (r.col === "closed") chips.push(r.srcStage === "won" ? WON_CHIP : LOST_CHIP);
    return {
      id: r.id,
      col: r.col,
      title: r.title,
      sub: r.sub,
      value: r.value,
      valueLabel: shortMoneyZero(r.value),
      chips,
      owner: avatarFor(roster, r.owner),
      ownerTitle: r.owner || "Unassigned",
      ageLabel: ageLabel(r.createdAt, nowMs),
      href: r.kind === "lead" ? `/leads?lead=${r.id}` : `/quotes?id=${r.id}`,
      canMoveTo: allowedMoves(r),
    };
  };
  const cards = filtered
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map(cardOf);
  const columns: BoardColumnVM[] = OPP_COLUMNS.map((c) => ({ key: c.key as string, label: c.label, dot: c.dot }));

  /* ---- toolbar options ---- */
  const ownerOptions = [
    { value: "all", label: "All teammates", href: hrefFor({ who: "all" }) },
  ].concat(
    users.map((p) => ({
      value: p.name === me.name ? "mine" : p.name,
      label: p.name === me.name ? p.name + " (me)" : p.name,
      href: hrefFor({ who: p.name === me.name ? "mine" : p.name }),
    }))
  );
  const ownerSelectValue = scope === "all" ? "all" : scope === "mine" ? "mine" : scope;
  const vtOptions = [{ value: "all", label: "All venue types", href: hrefFor({ vt: "" }) }].concat(
    CUSTOMER_TYPES.map((t) => ({ value: t as string, label: t as string, href: hrefFor({ vt: t }) }))
  );
  // kw stays latent until keyword authoring exists (plan 05, #23).
  const kwAvailable = kw !== "" || [...facts.values()].some((f) => f.keywords.length > 0);
  const kwParams = [
    ["who", scope === "all" ? "" : scope],
    ["created", created],
    ["forecast", forecast],
    ["vt", vt],
  ].filter(([, v]) => v !== "") as Array<[string, string]>;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{styleBlock}</style>

      {/* header — the board total IS the standfirst (#18 header total) */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          rowGap: 12,
          padding: "20px 24px 0",
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>Opportunities</div>
          <div style={{ fontSize: 13, color: "#8c919c", marginTop: 5 }}>{standfirst}</div>
        </div>
      </div>

      {/* toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          flexWrap: "wrap",
          padding: "14px 24px 0",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", background: "#eceef1", borderRadius: 9, padding: 3 }}>
          <Link
            href={hrefFor({ who: "mine" })}
            style={{
              ...segBase,
              ...(scope === "mine"
                ? { color: "#16181d", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.08)" }
                : { color: "#787d87" }),
            }}
          >
            My work
          </Link>
          <Link
            href={hrefFor({ who: "all" })}
            style={{
              ...segBase,
              ...(scope === "all"
                ? { color: "#16181d", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.08)" }
                : { color: "#787d87" }),
            }}
          >
            Everyone
          </Link>
        </div>
        <OwnerSelect value={ownerSelectValue} options={ownerOptions} />

        <span style={groupLbl}>Created</span>
        {(["", ...CREATED_KEYS] as const).map((k) => (
          <Link key={"c" + k} href={hrefFor({ created: k })} style={chipStyle(created === k)}>
            {k === "" ? "Any" : k}
          </Link>
        ))}

        <span style={groupLbl}>Forecast</span>
        {(["", ...FORECAST_KEYS] as const).map((k) => (
          <Link key={"f" + k} href={hrefFor({ forecast: k })} style={chipStyle(forecast === k)}>
            {k === "" ? "Any" : k === "past" ? "Past due" : "Next " + k}
          </Link>
        ))}

        <OwnerSelect value={vt || "all"} options={vtOptions} />
        {kwAvailable && <KwInput kw={kw} params={kwParams} />}
      </div>

      <BoardView columns={columns} cards={cards} moveAction={moveOpportunityAction} />
    </div>
  );
}

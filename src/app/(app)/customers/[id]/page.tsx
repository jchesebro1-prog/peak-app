import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { deriveInitials, fallbackColor } from "@/lib/team";
import { get as getCustomer } from "@/lib/stores/customers";
import { visitsForCustomer } from "@/lib/stores/site-visits";
import { getAll as getAllQuotes } from "@/lib/stores/quotes";
import { getAllProjects, riskFlags, stageIndex, stagesFor } from "@/lib/stores/projects";
import { getAll as getAllSurveys, stageMeta as surveyStageMeta } from "@/lib/stores/surveys";
import { byCustomer as commsByCustomer, snippet as commSnippet, statusMeta as commStatusMeta } from "@/lib/stores/comms";
import {
  coordsOf,
  estimate,
  fmtMiles,
  fmtTime,
  officesFromSettings,
} from "@/lib/geo";
import { shortDate, timeAgo } from "@/lib/format";
import { Avatar } from "@/components/ui";

export const metadata = { title: "Customer — Peak Backend" };
import { grantsFor, grantPath } from "@/lib/portal";
import { PortalAccessCard } from "./portal-access";
import EditCustomerModal from "../edit-modal";
import {
  ACCENT_INK,
  ACCENT_SOFT,
  cityState,
  custLocation,
  mono,
  money,
  moneyDash,
  quoteStatusMeta,
  TRAVEL_SOURCE_META,
  typeColor,
  venueKindLabel,
} from "../lib";
import type { SaveCustomerInput } from "../types";

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const card: CSSProperties = {
  background: "#fff",
  border: "1px solid #ececf0",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
  marginBottom: 24,
  overflow: "hidden",
};
const cardHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "14px 18px 12px",
  borderBottom: "1px solid #f0f1f4",
};

const CSS = `
  .cu-d-row:hover { background: #fafbff; }
  .cu-detail-grid { display: grid; grid-template-columns: minmax(0,1fr) 268px; gap: 18px; align-items: start; }
  @media (max-width: 1120px) { .cu-detail-grid { grid-template-columns: minmax(0,1fr); } }
  @media (max-width: 700px) { .cu-stats { grid-template-columns: repeat(2,1fr) !important; } }
`;

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, { id }, sp] = await Promise.all([requireUser(), params, searchParams]);
  const cust = await getCustomer(id);
  if (!cust) notFound();

  const [quotes, projects, surveys, threads, offices, users] = await Promise.all([
    getAllQuotes(),
    getAllProjects(),
    getAllSurveys(),
    commsByCustomer(id),
    officesFromSettings(),
    activeUsers(),
  ]);

  const edit = one(sp.edit);

  const roster = users.map((u) => ({ name: u.name, initials: u.initials, color: u.color }));
  const identOf = (name: string) => {
    const hit = roster.find((r) => r.name === name);
    return {
      initials: hit ? hit.initials : deriveInitials(name),
      color: hit ? hit.color : fallbackColor(name),
    };
  };

  /* ---- rolled-up quotes (by canonical id, name fallback) ---- */
  const custQuotes = quotes.filter((qt) =>
    qt.customerId ? qt.customerId === cust.id : qt.customer === cust.name
  );
  const openValue = custQuotes
    .filter((qt) => qt.status === "draft" || qt.status === "sent")
    .reduce((a, qt) => a + (qt.value || 0), 0);
  const wonValue = custQuotes
    .filter((qt) => qt.status === "won")
    .reduce((a, qt) => a + (qt.value || 0), 0);
  const totalQuoted = custQuotes.reduce((a, qt) => a + (qt.value || 0), 0);
  const wonCount = custQuotes.filter((qt) => qt.status === "won").length;
  const decided = custQuotes.filter((qt) => qt.status === "won" || qt.status === "lost").length;
  const winRate = decided > 0 ? Math.round((wonCount / decided) * 100) + "%" : "—";

  const custProjects = projects.filter((p) => p.customerId === cust.id);
  const custSurveys = surveys.filter((s) => s.customerId === cust.id);

  /* ---- derived account owner (newest quote/project owner) ---- */
  const ownerActs = [
    ...custQuotes.map((qt) => ({ at: qt.updatedAt || 0, owner: qt.owner || "" })),
    ...custProjects.map((p) => ({ at: p.updatedAt || 0, owner: p.owner || "" })),
  ].filter((r) => r.owner);
  ownerActs.sort((a, b) => b.at - a.at);
  const owner = ownerActs[0]?.owner || "";
  const ownerIdent = owner ? identOf(owner) : null;

  /* ---- locations with travel estimates ---- */
  const locations = await Promise.all(
    (cust.locations || []).map(async (l) => {
      const coords = coordsOf(l) || {};
      const est = await estimate(offices, { ...l, ...coords });
      const sm = TRAVEL_SOURCE_META[est.source] || TRAVEL_SOURCE_META.none;
      return {
        key: l.id || l.label || Math.random().toString(36).slice(2),
        label: l.label || "Venue",
        primary: !!l.primary,
        kindLabel: venueKindLabel(l.venueKind),
        address: [l.address, cityState(l)].filter(Boolean).join(" · ") || "—",
        officeName: est.office ? est.office.name : "nearest office",
        miles: fmtMiles(est.miles),
        time: fmtTime(est.minutes),
        sourceLabel: sm.label,
        sourceInk: sm.ink,
        sourceSoft: sm.soft,
      };
    })
  );
  const locN = (cust.locations || []).length;

  const contacts = (cust.contacts || []).map((ct) => ({ ...ct, mono: mono(ct.name) }));

  /* ---- site visits (D76) ---- */
  const visits = await visitsForCustomer(cust.id);

  /* ---- portal access grants (IDEAS #47) ---- */
  const portalGrants = (await grantsFor(cust.id)).map((g) => ({
    id: g.id,
    name: g.name,
    email: g.email,
    path: grantPath(g),
    createdAt: g.createdAt,
    revoked: !!g.revokedAt,
    lastSeenAt: g.lastSeenAt ?? null,
  }));

  /* ---- edit-modal initial ---- */
  const editInitial: SaveCustomerInput = {
    id: cust.id,
    name: cust.name,
    type: cust.type,
    locations: (cust.locations || []).map((l) => ({
      id: l.id,
      label: l.label || "",
      primary: !!l.primary,
      address: l.address || "",
      city: l.city || "",
      state: l.state || "",
      lat: l.lat == null || l.lat === "" ? null : Number(l.lat),
      lng: l.lng == null || l.lng === "" ? null : Number(l.lng),
      venueKind: l.venueKind || "proscenium",
      travelMiles: l.travelMiles ?? null,
      travelMin: l.travelMin ?? null,
    })),
    contacts: (cust.contacts || []).map((ct) => ({
      name: ct.name,
      role: ct.role,
      email: ct.email,
      phone: ct.phone || "",
      primary: ct.primary,
    })),
  };

  const tc = typeColor(cust.type);
  const commWaiting = threads.filter((t) => t.status === "waiting_us").length;

  const stats = [
    { label: "Open value", value: openValue > 0 ? money(openValue) : "—", color: openValue > 0 ? "#16181d" : "#aab0bb" },
    { label: "Won lifetime", value: money(wonValue), color: "#1f7a52" },
    { label: "Total quoted", value: money(totalQuoted), color: "#16181d" },
    { label: "Win rate", value: winRate, color: "#16181d" },
  ];

  return (
    <>
      <style>{CSS}</style>
      <div className="pk-content" style={{ maxWidth: 880 }}>
        <Link
          href="/customers"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#8c919c", textDecoration: "none", marginBottom: 16 }}
        >
          ‹ All customers
        </Link>

        {/* header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
          <span style={{ width: 54, height: 54, borderRadius: 13, background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
            {mono(cust.name)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>{cust.name}</span>
              {cust.type && (
                <span style={{ fontSize: 11, fontWeight: 600, color: tc, background: `color-mix(in srgb, ${tc} 12%, #fff)`, padding: "3px 10px", borderRadius: 20 }}>
                  {cust.type}
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: "#8c919c", marginTop: 4 }}>{custLocation(cust)}</div>
            {ownerIdent && (
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 9 }}>
                <Avatar name={owner} initials={ownerIdent.initials} color={ownerIdent.color} size={22} />
                <span style={{ fontSize: 12, color: "#5b616e" }}>
                  Account owner · <b style={{ fontWeight: 600, color: "#3a3f4a" }}>{owner}</b>
                </span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 9, flexShrink: 0 }}>
            <Link
              href={`/customers/${encodeURIComponent(cust.id)}?edit=1`}
              style={{ fontSize: 12.5, fontWeight: 600, color: "#3a3f4a", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "9px 14px", textDecoration: "none" }}
            >
              Edit
            </Link>
            <Link
              href="/estimator"
              style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "var(--accent)", borderRadius: 8, padding: "10px 15px", textDecoration: "none" }}
            >
              + New quote
            </Link>
          </div>
        </div>

        {/* stat strip */}
        <div className="cu-stats" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 13, marginBottom: 24 }}>
          {stats.map((s) => (
            <div key={s.label} style={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 11, padding: "14px 15px", boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase" }}>{s.label}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 600, marginTop: 8, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* locations & venues */}
        <div style={card}>
          <div style={cardHead}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Locations &amp; venues</div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>
              {locN} venue{locN === 1 ? "" : "s"}
            </span>
          </div>
          {locations.map((l) => (
            <div key={l.key} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 196px", gap: 16, padding: "15px 18px", borderBottom: "1px solid #f5f6f8", alignItems: "start" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{l.label}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#5b616e", background: "#f1f2f5", border: "1px solid #e4e7ec", padding: "2px 8px", borderRadius: 20 }}>
                    {l.kindLabel}
                  </span>
                  {l.primary && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: ACCENT_INK, background: ACCENT_SOFT, padding: "1px 6px", borderRadius: 4, letterSpacing: ".03em" }}>
                      PRIMARY
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#8c919c", marginTop: 5 }}>{l.address}</div>
              </div>
              <div style={{ background: "#fafbfc", border: "1px solid #eef0f3", borderRadius: 10, padding: "11px 12px" }}>
                <div style={{ fontSize: 9.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  Travel · {l.officeName}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 17, fontWeight: 600, color: "#16181d" }}>{l.miles}</span>
                  <span style={{ fontSize: 12, color: "#5b616e" }}>· {l.time}</span>
                </div>
                <span style={{ display: "inline-block", marginTop: 7, fontSize: 9, fontWeight: 600, letterSpacing: ".03em", padding: "2px 7px", borderRadius: 5, color: l.sourceInk, background: l.sourceSoft }}>
                  {l.sourceLabel}
                </span>
              </div>
            </div>
          ))}
          {locN === 0 && (
            <div style={{ padding: "26px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
              No locations yet — add one in Edit.
            </div>
          )}
        </div>

        {/* communications */}
        <div style={card}>
          <div style={cardHead}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14.5, fontWeight: 600 }}>Communications</span>
              {commWaiting > 0 && (
                <span style={{ fontSize: 10.5, fontWeight: 600, color: "#b4543a", background: "#f8ece7", border: "1px solid #eccfc4", padding: "2px 8px", borderRadius: 20 }}>
                  {commWaiting} waiting on us
                </span>
              )}
            </div>
            <Link
              href={`/inbox?new=${encodeURIComponent(cust.id)}`}
              style={{ fontSize: 12, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: `1px solid ${ACCENT_SOFT}`, borderRadius: 8, padding: "8px 12px", textDecoration: "none" }}
            >
              + Log interaction
            </Link>
          </div>
          {threads.map((t) => {
            const sm = commStatusMeta(t.status);
            const ident = t.assignedTo ? identOf(t.assignedTo) : null;
            return (
              <Link
                key={t.id}
                href={`/inbox?thread=${encodeURIComponent(t.id)}`}
                className="cu-d-row"
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 600, color: sm.ink, background: sm.soft, border: `1px solid ${sm.bd}`, padding: "2px 8px", borderRadius: 20, flexShrink: 0 }}>
                      {sm.label}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.subject || "Conversation"}
                    </span>
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, color: "#9aa0ab", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {commSnippet(t)}
                  </span>
                </span>
                <span style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  {ident && <Avatar name={t.assignedTo} initials={ident.initials} color={ident.color} size={22} />}
                  <span style={{ fontSize: 10.5, color: "#aab0bb" }}>{timeAgo(t.updatedAt)}</span>
                </span>
              </Link>
            );
          })}
          {threads.length === 0 && (
            <div style={{ padding: "26px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
              No logged interactions yet. Log a call, email, or meeting to start this customer&apos;s history.
            </div>
          )}
        </div>

        {/* projects & orders */}
        <div style={card}>
          <div style={cardHead}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Projects &amp; orders</div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{custProjects.length}</span>
          </div>
          {custProjects.map((p) => {
            const stages = stagesFor(p.kind);
            const st = stages[stageIndex(p.kind, p.stage)] || stages[0];
            const done = p.stage === "complete";
            const risk = !done && riskFlags(p).length > 0;
            const m = done
              ? { ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", l: "Complete" }
              : risk
                ? { ink: "#b4543a", soft: "#f8ece7", bd: "#eccfc4", l: st.short }
                : { ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3", l: st.short };
            return (
              <Link
                key={p.id}
                href={`/projects?id=${encodeURIComponent(p.id)}`}
                className="cu-d-row"
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {p.name || p.id}
                  </span>
                  <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 2 }}>
                    {p.id} · {p.kind === "order" ? "Sales order" : "Project"} · {money(p.value)}
                  </span>
                </span>
                <span style={{ fontSize: 9.5, fontWeight: 600, color: m.ink, background: m.soft, border: `1px solid ${m.bd}`, padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap", flexShrink: 0 }}>
                  {m.l}
                </span>
              </Link>
            );
          })}
          {custProjects.length === 0 && (
            <div style={{ padding: "26px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
              No active projects for this customer.
            </div>
          )}
        </div>

        <div className="cu-detail-grid">
          {/* quotes */}
          <div style={{ ...card, marginBottom: 0 }}>
            <div style={{ padding: "14px 18px 12px", borderBottom: "1px solid #f0f1f4", fontSize: 14.5, fontWeight: 600 }}>Quotes</div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 102px 96px 92px", gap: 10, padding: "9px 18px", fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em", background: "#fafbfc", borderBottom: "1px solid #f0f1f4" }}>
              <span>Project</span>
              <span>Status</span>
              <span style={{ textAlign: "right" }}>Value</span>
              <span style={{ textAlign: "right" }}>Date</span>
            </div>
            {custQuotes.map((qt) => {
              const m = quoteStatusMeta(qt.status);
              return (
                <Link
                  key={qt.id}
                  href={`/estimator?id=${encodeURIComponent(qt.id)}`}
                  className="cu-d-row"
                  style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 102px 96px 92px", gap: 10, padding: "13px 18px", alignItems: "center", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {qt.name || qt.id}
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 2 }}>{qt.id}</div>
                  </div>
                  <span>
                    <span style={{ display: "inline-block", fontSize: 10.5, fontWeight: 600, color: m.ink, background: m.soft, border: `1px solid ${m.bd}`, padding: "3px 9px", borderRadius: 20 }}>
                      {m.label}
                    </span>
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600, textAlign: "right" }}>{moneyDash(qt.value)}</span>
                  <span style={{ fontSize: 11.5, color: "#8c919c", textAlign: "right" }}>{shortDate(qt.updatedAt)}</span>
                </Link>
              );
            })}
            {custQuotes.length === 0 && (
              <div style={{ padding: "34px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
                No quotes yet for this customer.
              </div>
            )}
          </div>

          {/* right column: surveys + contacts */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ ...card, marginBottom: 0 }}>
              <div style={cardHead}>
                <span style={{ fontSize: 14.5, fontWeight: 600 }}>Site surveys</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{custSurveys.length}</span>
              </div>
              {custSurveys.map((s) => {
                const sm = surveyStageMeta(s.stage || "requested");
                return (
                  <Link
                    key={s.id}
                    href={`/field-survey?id=${encodeURIComponent(s.id)}`}
                    className="cu-d-row"
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 600, color: sm.ink, background: sm.soft, border: `1px solid ${sm.bd}`, padding: "2px 9px", borderRadius: 20, whiteSpace: "nowrap", flexShrink: 0 }}>
                      {sm.label}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.venue || s.venueType || "Site survey"}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", flexShrink: 0 }}>{s.id}</span>
                  </Link>
                );
              })}
              {custSurveys.length === 0 && (
                <div style={{ padding: "26px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
                  No site surveys yet.
                </div>
              )}
            </div>

            <div style={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", padding: "15px 16px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 12 }}>Contacts</div>
              {contacts.map((ct, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderTop: "1px solid #f3f4f7" }}>
                  <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#f1f2f5", color: "#5b616e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                    {ct.mono}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>
                      {ct.name}
                      {ct.primary && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: ACCENT_INK, background: ACCENT_SOFT, padding: "1px 5px", borderRadius: 4, marginLeft: 5, letterSpacing: ".03em" }}>
                          PRIMARY
                        </span>
                      )}
                    </div>
                    {ct.role && <div style={{ fontSize: 11, color: "#8c919c", marginTop: 1 }}>{ct.role}</div>}
                    {ct.email && (
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {ct.email}
                      </div>
                    )}
                    {ct.phone && (
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {ct.phone}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {contacts.length === 0 && (
                <div style={{ fontSize: 12, color: "#9aa0ab", paddingTop: 4 }}>No contacts yet.</div>
              )}
            </div>

            <PortalAccessCard
              customerId={cust.id}
              contacts={(cust.contacts || []).map((ct) => ({
                name: ct.name,
                email: ct.email || "",
              }))}
              grants={portalGrants}
            />

            {/* ---- site visits (D76) — scheduled from the Inbox ---- */}
            {visits.length > 0 && (
              <div style={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", padding: "15px 16px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 12 }}>
                  Site visits
                </div>
                {visits.slice(0, 6).map((v) => (
                  <div key={v.id} style={{ padding: "8px 0", borderTop: "1px solid #f3f4f7" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>
                      {v.reason}
                      {v.venue ? " · " + v.venue : ""}
                    </div>
                    <div style={{ fontSize: 11, color: "#8c919c", marginTop: 2 }}>
                      {new Date(v.startAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      {" · "}
                      {v.assignedTo}
                      {v.invite?.sentAt ? " · invite sent" : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {edit === "1" && <EditCustomerModal mode="edit" initial={editInitial} closeHref={`/customers/${encodeURIComponent(cust.id)}`} />}
    </>
  );
}

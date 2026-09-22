import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import { get as getCustomer } from "@/lib/stores/customers";
import { contactsForCompany, displayName, emailsForContacts, phonesForContacts } from "@/lib/identity/contacts";
import { loadVendors } from "@/lib/vendor-tasks";
import { VENDOR_STATUS_META } from "@/lib/vendor-status";
import { loadCustomerFeed } from "@/lib/customer-feed";
import { groupRows } from "@/lib/feed-buckets";
import { dateYear, timeAgo } from "@/lib/format";
import ActivityComposer from "@/app/(app)/companies/[id]/activity-composer";
import { ACCENT_INK, ACCENT_SOFT, mono, typeColor } from "@/app/(app)/companies/lib";
import { VENDOR_TABS, VENDOR_TAB_LABEL, resolveVendorTab, type VendorTab } from "../tabs";
import { toDateInput } from "../dates";
import OverviewTab from "./overview-tab";
import ContactsTab, { type VendorContactVM } from "./contacts-tab";
import PriceListsTab from "./price-lists-tab";

export const metadata = { title: "Vendor — Quartzite-6" };

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
const CSS = `.vn-d-row:hover { background: #fafbff; }`;

export default async function VendorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, { id }, sp] = await Promise.all([requireUser(), params, searchParams]);
  const cust = await getCustomer(id);
  if (!cust) notFound();
  const [data, contactRows, feedRows] = await Promise.all([
    loadVendors(cust.id),
    contactsForCompany(cust.id),
    loadCustomerFeed({ id: cust.id, name: cust.name }),
  ]);
  // loadVendors only returns companies typed vendor/manufacturer — any other
  // company has no vendor page (it has /companies/[id]).
  const row = data.rows[0];
  if (!row) notFound();

  const ids = contactRows.map((c) => c.id);
  const [emailsBy, phonesBy] = await Promise.all([emailsForContacts(ids), phonesForContacts(ids)]);
  const contacts: VendorContactVM[] = contactRows.map((c) => ({
    id: c.id,
    name: displayName(c),
    title: c.title || "",
    email: emailsBy.get(c.id)?.[0]?.email || "",
    phone: phonesBy.get(c.id)?.[0]?.phone || "",
    primary: c.isPrimary,
    role: row.profile.contactRoles[c.id] || "",
  }));

  const tab = resolveVendorTab(one(sp.tab));
  const sm = VENDOR_STATUS_META[row.status];
  const tc = typeColor(row.type);
  const tabHref = (t: VendorTab) => `/vendors/${encodeURIComponent(row.id)}?tab=${t}`;
  const counts: Partial<Record<VendorTab, number>> = {
    contacts: contacts.length,
    prices: row.profile.priceLists.length,
    activity: feedRows.length,
  };
  const feedGroups = groupRows(feedRows, Date.now());
  const todayInput = toDateInput(Date.now());

  return (
    <>
      <style>{CSS}</style>
      <div className="pk-content" style={{ maxWidth: 880 }}>
        <Link href="/vendors" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#8c919c", textDecoration: "none", marginBottom: 16 }}>
          ‹ All vendors
        </Link>

        {/* header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
          <span style={{ width: 54, height: 54, borderRadius: 13, background: "var(--accent)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
            {mono(row.name)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>{row.name}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: tc, background: `color-mix(in srgb, ${tc} 12%, #fff)`, padding: "3px 10px", borderRadius: 20 }}>
                {row.type}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: sm.ink, background: sm.soft, border: `1px solid ${sm.bd}`, padding: "3px 10px", borderRadius: 20 }}>
                {sm.label}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 5, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <span>Catalog priced {dateYear(row.catalogEffectiveAt)}</span>
              <span>Last list {row.lastList ? `received ${dateYear(row.lastList.receivedAt)}, effective ${dateYear(row.lastList.effectiveAt)}` : "—"}</span>
              <span>{row.partCount} part{row.partCount === 1 ? "" : "s"}</span>
            </div>
            {row.openTask && (
              <div style={{ marginTop: 8, fontSize: 12.5 }}>
                <span style={{ color: "#8c919c" }}>Owner task · </span>
                <Link href={`/queue?who=${encodeURIComponent(row.openTask.assignee)}`} style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
                  {row.openTask.title}
                </Link>
                <span style={{ color: "#8c919c" }}> — {row.openTask.assignee}</span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 9, flexShrink: 0 }}>
            <Link href={`/companies/${encodeURIComponent(row.id)}?edit=1`} style={{ fontSize: 12.5, fontWeight: 600, color: "#3a3f4a", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "9px 14px", textDecoration: "none" }}>
              Edit
            </Link>
            <Link href={`/inbox?customer=${encodeURIComponent(row.id)}`} style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "var(--accent)", borderRadius: 8, padding: "10px 15px", textDecoration: "none" }}>
              New email
            </Link>
          </div>
        </div>

        {/* tab strip — the engagements/view.tsx idiom */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid #eef0f3", paddingBottom: 10, marginBottom: 18 }}>
          {VENDOR_TABS.map((t) => (
            <Link
              key={t}
              href={tabHref(t)}
              style={{
                textDecoration: "none", fontSize: 12.5, fontWeight: 600, padding: "7px 12px", borderRadius: 8,
                color: tab === t ? "color-mix(in srgb, var(--accent) 70%, #000)" : "#8c919c",
                background: tab === t ? "color-mix(in srgb, var(--accent) 10%, #fff)" : "transparent",
                border: tab === t ? "1px solid color-mix(in srgb, var(--accent) 30%, #fff)" : "1px solid transparent",
              }}
            >
              {VENDOR_TAB_LABEL[t]}
              {counts[t] ? <span style={{ marginLeft: 6, color: "#9aa0ab", fontWeight: 500 }}>{counts[t]}</span> : null}
            </Link>
          ))}
        </div>

        {tab === "overview" && (
          <OverviewTab
            vendorId={row.id}
            discounts={row.profile.discounts}
            registration={row.profile.registration}
            manufacturers={row.profile.manufacturers}
            directory={data.directory}
          />
        )}
        {tab === "contacts" && <ContactsTab vendorId={row.id} contacts={contacts} />}
        {tab === "prices" && (
          <PriceListsTab
            vendorId={row.id}
            priceLists={row.profile.priceLists}
            status={row.status}
            catalogEffectiveAt={row.catalogEffectiveAt}
            todayInput={todayInput}
          />
        )}
        {tab === "activity" && (
          <div style={card}>
            <div style={cardHead}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>Activity</div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{feedRows.length}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Link href={`/inbox?customer=${encodeURIComponent(row.id)}&log=1`} style={{ fontSize: 12, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: `1px solid ${ACCENT_SOFT}`, borderRadius: 8, padding: "8px 12px", textDecoration: "none" }}>
                  Log call
                </Link>
                <Link href={`/inbox?customer=${encodeURIComponent(row.id)}`} style={{ fontSize: 12, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: `1px solid ${ACCENT_SOFT}`, borderRadius: 8, padding: "8px 12px", textDecoration: "none" }}>
                  New email
                </Link>
              </div>
            </div>
            <ActivityComposer customerId={row.id} />
            {feedGroups.map((g) => (
              <div key={g.bucket}>
                <div style={{ padding: "9px 18px 7px", fontSize: 10, fontWeight: 600, color: "#aab0bb", letterSpacing: ".05em", textTransform: "uppercase", background: "#fafbfc", borderBottom: "1px solid #f0f1f4" }}>
                  {g.bucket}
                </div>
                {g.rows.map((r) => {
                  const rowStyle: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 11, padding: "10px 18px", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" };
                  const inner = (
                    <>
                      <span style={{ width: 26, height: 26, borderRadius: "50%", background: r.soft, color: r.ink, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700, flexShrink: 0 }}>
                        {r.letter}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                          {r.title}
                        </span>
                        <span style={{ display: "block", fontSize: 11, color: "#aab0bb", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {[r.sub, r.by, timeAgo(r.ts)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </>
                  );
                  return r.href ? (
                    <Link key={r.id} href={r.href} className="vn-d-row" style={rowStyle}>
                      {inner}
                    </Link>
                  ) : (
                    <div key={r.id} style={rowStyle}>
                      {inner}
                    </div>
                  );
                })}
              </div>
            ))}
            {feedRows.length === 0 && (
              <div style={{ padding: "26px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
                No activity yet — emails, calls and notes linked to this vendor land here.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

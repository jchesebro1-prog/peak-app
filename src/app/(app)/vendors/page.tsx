import Link from "next/link";
import { requireUser } from "@/lib/session";
import { loadVendors } from "@/lib/vendor-tasks";
import { VENDOR_STATUS_KEYS, VENDOR_STATUS_META, type VendorStatusKey } from "@/lib/vendor-status";
import { dateYear } from "@/lib/format";
import { mono } from "@/app/(app)/companies/lib";
import { NewVendorForm, UnclaimedPanel, VendorFilterBar } from "./controls";

export const metadata = { title: "Vendors — Quartzite-6" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const CSS = `
  .vn-row:hover { background: #fafbff; }
  .vn-grid { display: grid; grid-template-columns: minmax(0,1.3fr) minmax(0,1.4fr) 52px 108px 150px 132px minmax(0,1fr); gap: 10px; align-items: center; }
  @media (max-width: 900px) {
    .vn-grid { grid-template-columns: minmax(0,1.3fr) 108px 132px; }
    .vn-wide { display: none !important; }
  }
`;

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, data] = await Promise.all([requireUser(), searchParams, loadVendors()]);
  const q = one(sp.q).trim();
  const statusParam = one(sp.status);
  const status: VendorStatusKey | "all" = (VENDOR_STATUS_KEYS as readonly string[]).includes(statusParam)
    ? (statusParam as VendorStatusKey)
    : "all";
  const isNew = one(sp.new) === "1";

  const ql = q.toLowerCase();
  const rows = data.rows.filter((r) => {
    if (status !== "all" && r.status !== status) return false;
    if (ql && !(r.name + " " + r.profile.manufacturers.join(" ")).toLowerCase().includes(ql)) return false;
    return true;
  });
  const counts = Object.fromEntries(
    VENDOR_STATUS_KEYS.map((k) => [k, data.rows.filter((r) => r.status === k).length])
  ) as Record<VendorStatusKey, number>;
  const unclaimed = data.directory.filter((m) => !m.vendorId).map((m) => ({ name: m.name, count: m.count }));

  const th: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em" };
  const cell: React.CSSProperties = { fontSize: 12.5, color: "#3a3f4a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

  return (
    <div className="pk-content" style={{ maxWidth: 1080, margin: "0 auto" }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Vendors</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "#9aa0ab" }}>{data.rows.length}</span>
          <span style={{ fontSize: 12, color: "#8c919c" }}>
            Catalog owner: <b style={{ color: "#3a3f4a" }}>{data.ownerName || "nobody"}</b>
            {" · "}
            <Link href="/catalog" style={{ color: "var(--accent)", textDecoration: "none" }}>change in Catalog</Link>
          </span>
        </div>
        <Link
          href="/vendors?new=1"
          style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "var(--accent)", borderRadius: 8, padding: "9px 14px", textDecoration: "none" }}
        >
          + New vendor
        </Link>
      </div>

      {isNew && <NewVendorForm />}

      <VendorFilterBar q={q} status={status} counts={counts} total={data.rows.length} />

      <div className="pk-card" style={{ padding: 0, overflow: "hidden", marginBottom: 18 }}>
        <div className="vn-grid" style={{ padding: "9px 18px", background: "#fafbfc", borderBottom: "1px solid #f0f1f4" }}>
          <span style={th}>Vendor</span>
          <span className="vn-wide" style={th}>Manufacturers</span>
          <span className="vn-wide" style={{ ...th, textAlign: "right" }}>Parts</span>
          <span style={th}>Catalog priced</span>
          <span className="vn-wide" style={th}>Last list rec’d / eff.</span>
          <span style={th}>Status</span>
          <span className="vn-wide" style={th}>Owner task</span>
        </div>
        {rows.map((r) => {
          const sm = VENDOR_STATUS_META[r.status];
          return (
            <div key={r.id} className="vn-row vn-grid" style={{ padding: "12px 18px", borderBottom: "1px solid #f5f6f8" }}>
              <Link href={`/vendors/${encodeURIComponent(r.id)}`} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, textDecoration: "none", color: "inherit" }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: "#f1f2f5", color: "#5b616e", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 11.5, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                  {mono(r.name)}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
              </Link>
              <span className="vn-wide" style={{ display: "flex", gap: 4, flexWrap: "wrap", minWidth: 0 }}>
                {r.profile.manufacturers.map((m) => (
                  <span key={m} style={{ fontSize: 10.5, fontWeight: 600, color: "#5b616e", background: "#f1f2f5", border: "1px solid #e4e7ec", padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap" }}>
                    {m}
                  </span>
                ))}
                {r.profile.manufacturers.length === 0 && <span style={{ fontSize: 12, color: "#aab0bb" }}>none claimed</span>}
              </span>
              <span className="vn-wide" style={{ ...cell, fontFamily: "var(--font-mono)", textAlign: "right" }}>{r.partCount}</span>
              <span style={cell}>{dateYear(r.catalogEffectiveAt)}</span>
              <span className="vn-wide" style={cell}>
                {r.lastList ? `${dateYear(r.lastList.receivedAt)} / ${dateYear(r.lastList.effectiveAt)}` : "—"}
              </span>
              <span>
                <span style={{ display: "inline-block", fontSize: 10.5, fontWeight: 600, color: sm.ink, background: sm.soft, border: `1px solid ${sm.bd}`, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>
                  {sm.label}
                </span>
              </span>
              <span className="vn-wide" style={{ minWidth: 0 }}>
                {r.openTask ? (
                  <Link
                    href={`/queue?who=${encodeURIComponent(r.openTask.assignee)}`}
                    title={`${r.openTask.title} — ${r.openTask.assignee}`}
                    style={{ ...cell, display: "block", color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}
                  >
                    {r.openTask.title}
                  </Link>
                ) : (
                  <span style={{ fontSize: 12, color: "#aab0bb" }}>—</span>
                )}
              </span>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div style={{ padding: "44px 22px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
            {data.rows.length === 0
              ? "No vendors yet — claim a manufacturer below or add one with + New vendor."
              : ql
                ? `No vendors match “${q}”.`
                : "No vendors in this status."}
          </div>
        )}
      </div>

      <UnclaimedPanel items={unclaimed} vendors={data.rows.map((r) => ({ id: r.id, name: r.name }))} />
    </div>
  );
}

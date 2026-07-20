import Link from "next/link";
import { requireUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { deriveInitials, fallbackColor } from "@/lib/team";
import { all as allCustomers } from "@/lib/stores/customers";
import { getAll as getAllQuotes } from "@/lib/stores/quotes";
import { getAllProjects } from "@/lib/stores/projects";
import { coordsOf } from "@/lib/geo";
import { Avatar } from "@/components/ui";
import type { MapPin } from "@/components/map/LeafletMap";
import { CustomersMap, FilterBar } from "./controls";
import EditCustomerModal from "./edit-modal";
import { cityState, custLocation, mono, moneyK, typeColor } from "./lib";

export const metadata = { title: "Companies — Peak Backend" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const CSS = `
  .cu-row:hover { background: #fafbff; }
  @media (max-width: 720px) {
    .cu-row-owner { display: none !important; }
  }
`;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [me, sp, customers, quotes, projects, users] = await Promise.all([
    requireUser(),
    searchParams,
    allCustomers(),
    getAllQuotes(),
    getAllProjects(),
    activeUsers(),
  ]);

  const q = one(sp.q);
  const typeParam = one(sp.type) || "all";
  const scope = one(sp.scope) || "all";
  const view = one(sp.view);
  const edit = one(sp.edit);

  const roster = users.map((u) => ({ name: u.name, initials: u.initials, color: u.color }));
  const identOf = (name: string) => {
    const hit = roster.find((r) => r.name === name);
    return {
      initials: hit ? hit.initials : deriveInitials(name),
      color: hit ? hit.color : fallbackColor(name),
    };
  };

  /* ---- per-customer activity rollups (quotes / projects live by id|name) ---- */
  const quotesFor = (id: string, name: string) =>
    quotes.filter((qt) => (qt.customerId ? qt.customerId === id : !!name && qt.customer === name));
  const projectsFor = (id: string) => projects.filter((p) => p.customerId === id);

  const rollup = (id: string, name: string) => {
    const qs = quotesFor(id, name);
    const openValue = qs
      .filter((qt) => qt.status === "draft" || qt.status === "sent")
      .reduce((a, qt) => a + (qt.value || 0), 0);
    const acts = [
      ...qs.map((qt) => ({ at: qt.updatedAt || 0, owner: qt.owner || "" })),
      ...projectsFor(id).map((p) => ({ at: p.updatedAt || 0, owner: p.owner || "" })),
    ].filter((r) => r.owner);
    acts.sort((a, b) => b.at - a.at);
    return { openValue, quoteCount: qs.length, owner: acts[0]?.owner || "" };
  };

  const rows = customers.map((c) => {
    const r = rollup(c.id, c.name);
    // A stored owner wins; the rollup is the fallback for records that predate
    // the field or have never been assigned (D83, punch item 23 D).
    if (c.owner) r.owner = c.owner;
    return { c, ...r };
  });

  /* ---- filters ---- */
  const ql = q.trim().toLowerCase();
  const filtered = rows.filter(({ c, owner }) => {
    if (scope === "mine" && owner !== me.name) return false;
    if (scope !== "all" && scope !== "mine" && owner !== scope) return false;
    if (typeParam !== "all" && c.type !== typeParam) return false;
    if (ql) {
      const hay = (
        c.name +
        " " +
        (c.locations || []).map((l) => [l.label, l.city, l.state].filter(Boolean).join(" ")).join(" ")
      ).toLowerCase();
      if (!hay.includes(ql)) return false;
    }
    return true;
  });

  const types = ["all", ...Array.from(new Set(customers.map((c) => c.type).filter(Boolean)))];
  const ownerOptions = [
    { value: "all", label: "All teammates" },
    ...roster.map((p) => ({ value: p.name, label: p.name === me.name ? p.name + " (me)" : p.name })),
  ];

  /* ---- map pins ---- */
  const pins: MapPin[] = [];
  filtered.forEach(({ c }) => {
    (c.locations || []).forEach((l) => {
      const co = coordsOf(l);
      if (!co) return;
      pins.push({
        id: c.id + (l.id || ""),
        lat: co.lat,
        lng: co.lng,
        color: typeColor(c.type),
        label: c.name,
        sub: [l.label, cityState(l)].filter(Boolean).join(" · "),
        href: `/companies/${encodeURIComponent(c.id)}`,
      });
    });
  });

  const hasCustomers = customers.length > 0;
  const mapMode = view === "map";

  const mapBtn = (
    <Link
      href="/companies?view=map"
      title="View all company venues on a map"
      style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#3a3f4a", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px 12px", textDecoration: "none" }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
      Map
    </Link>
  );
  const newBtn = (
    <Link
      href="/companies?edit=new"
      style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", borderRadius: 8, padding: "9px 14px", textDecoration: "none" }}
    >
      + New
    </Link>
  );

  return (
    <>
      <style>{CSS}</style>

      {mapMode ? (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 24px", background: "#fff", borderBottom: "1px solid #ececf0", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 9, minWidth: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Company map</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#9aa0ab", whiteSpace: "nowrap" }}>
                {pins.length} located venues
              </span>
            </div>
            <Link
              href="/companies"
              style={{ fontSize: 12.5, fontWeight: 600, color: "#3a3f4a", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px 13px", textDecoration: "none", whiteSpace: "nowrap" }}
            >
              Close map
            </Link>
          </div>
          <CustomersMap pins={pins} />
        </div>
      ) : (
        <div className="pk-content" style={{ maxWidth: 760, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
              <span style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Companies</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "#9aa0ab" }}>{customers.length}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {mapBtn}
              {newBtn}
            </div>
          </div>

          {hasCustomers && (
            <FilterBar q={q} type={typeParam} scope={scope} types={types} ownerOptions={ownerOptions} meName={me.name} />
          )}

          {!hasCustomers ? (
            <div className="pk-card" style={{ padding: "60px 30px", textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#3a3f4a" }}>No companies yet</div>
              <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6 }}>
                Add your first company to start building quotes and projects.
              </div>
              <Link
                href="/companies?edit=new"
                style={{ display: "inline-block", marginTop: 16, fontSize: 13, fontWeight: 600, color: "#fff", background: "var(--accent)", borderRadius: 9, padding: "11px 18px", textDecoration: "none" }}
              >
                + New company
              </Link>
            </div>
          ) : (
            <div className="pk-card" style={{ padding: 0, overflow: "hidden" }}>
              {filtered.map(({ c, openValue, quoteCount, owner }) => {
                const ident = owner ? identOf(owner) : null;
                const venueN = (c.locations || []).length;
                const sub =
                  (c.type || "Customer") +
                  " · " +
                  custLocation(c) +
                  (venueN > 1 ? " · " + venueN + " venues" : "");
                return (
                  <Link
                    key={c.id}
                    href={`/companies/${encodeURIComponent(c.id)}`}
                    className="cu-row"
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" }}
                  >
                    <span style={{ width: 38, height: 38, borderRadius: 9, background: "#f1f2f5", color: "#5b616e", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12.5, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                      {mono(c.name)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {c.name}
                      </span>
                      <span style={{ display: "block", fontSize: 11.5, color: "#8c919c", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {sub}
                      </span>
                    </span>
                    <span className="cu-row-owner" style={{ flexShrink: 0 }}>
                      {ident ? (
                        <Avatar name={owner} initials={ident.initials} color={ident.color} size={24} />
                      ) : (
                        <span style={{ width: 24, height: 24, borderRadius: "50%", border: "1.5px dashed #d3d6dd", display: "inline-block" }} />
                      )}
                    </span>
                    <span style={{ textAlign: "right", flexShrink: 0 }}>
                      <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600 }}>
                        {openValue > 0 ? moneyK(openValue) : "—"}
                      </span>
                      <span style={{ display: "block", fontSize: 10.5, color: "#aab0bb", marginTop: 2 }}>
                        {quoteCount} quote{quoteCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </Link>
                );
              })}
              {filtered.length === 0 && (
                <div style={{ padding: "50px 22px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
                  {ql ? `No companies match “${q.trim()}”.` : "No companies match these filters."}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {edit === "new" && <EditCustomerModal mode="new" initial={null} closeHref="/companies" />}
    </>
  );
}

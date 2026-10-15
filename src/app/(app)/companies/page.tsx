import Link from "next/link";
import { requireUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { can, deriveInitials, fallbackColor } from "@/lib/team";
import { DeleteCompanyButton } from "./delete-company-button";
import { allForDirectory, primaryLoc } from "@/lib/stores/customers";
import { listQuoteRows } from "@/lib/stores/quotes";
import { listProjectActivityRows } from "@/lib/stores/projects";
import { companyIdsWithContactMatching } from "@/lib/identity/contacts";
import { companyRollups, filterCompanyDirectory } from "@/lib/company-directory";
import { paginate, parsePageParam, withPage } from "@/lib/list-paging";
import { ListPager } from "@/components/list-pager";
import { coordsOf } from "@/lib/geo";
import { Avatar } from "@/components/ui";
import { FilterBar } from "./controls";
import { CompanyMapClient } from "./map-client";
import PopLink from "@/components/popout/pop-link";
import { customerPopUrl } from "@/lib/popout/click";
import type { CompanyMapFilters, CompanyMapPoint } from "./map-filter";
import EditCustomerModal from "./edit-modal";
import { custLocation, mono, moneyK } from "./lib";
import { getSettings } from "@/lib/settings";
import { venueTypesFrom } from "@/lib/venue-types";
import { resolveFieldDefs } from "@/lib/customer-fields";
import { travelForPoints } from "@/lib/travel-bulk";
import { compareDrive, driveTitle, fmtDrive, parseDriveSort } from "@/lib/drive-format";

export const metadata = { title: "Companies — Quartzite-6" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/** Directory paging (Jeff 2026-10-15 #11, replacing #224's "Show more"): 50 a page, Prev / Next and
 *  "Page X of Y", the page in `?page=`. Filters, search and sort run over every company first. Every
 *  current query param carries over except `page` (set by the pager) and `edit` (a transient
 *  modal-open flag) and #224's retired `n`. */
function pageParamsOf(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "page" || k === "n" || k === "edit" || v === undefined) continue;
    const val = Array.isArray(v) ? v[0] : v;
    if (val) params.set(k, val);
  }
  return params;
}

const CSS = `
  .cu-row:hover { background: #fafbff; }
  @media (max-width: 720px) {
    .cu-row-owner { display: none !important; }
  }
  /* #176 fix 7 — the drive cell's inline width crowds the name column on a
     phone; the cell has an inline width (110px) so this needs !important to
     win, same as the rule above. */
  @media (max-width: 480px) {
    .cu-row-drive { width: 84px !important; font-size: 10.5px !important; }
  }
`;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Jeff 2026-10-15 #11 — slim reads: companies + venues (no contacts), and only the quote / project fields
  // the rollups need (SQL projections), so the whole directory filters without loading whole documents.
  const [me, sp, customers, quotes, projects, users, settings] = await Promise.all([
    requireUser(),
    searchParams,
    allForDirectory(),
    listQuoteRows(),
    listProjectActivityRows(),
    activeUsers(),
    getSettings(),
  ]);
  const canDelete = can("create", me.roles);
  const fieldDefs = resolveFieldDefs(settings.customerFieldDefs);
  const venueTypes = venueTypesFrom(settings.venueTypes);

  const q = one(sp.q);
  const typeParam = one(sp.type) || "all";
  const scope = one(sp.scope) || "all";
  const view = one(sp.view);
  const edit = one(sp.edit);
  // #22/#23 "Added in last 7 days" — one allowlisted value, strip-default.
  const added = one(sp.added) === "7d" ? "7d" : "";

  const roster = users.map((u) => ({ name: u.name, initials: u.initials, color: u.color }));
  const identOf = (name: string) => {
    const hit = roster.find((r) => r.name === name);
    return {
      initials: hit ? hit.initials : deriveInitials(name),
      color: hit ? hit.color : fallbackColor(name),
    };
  };

  /* ---- per-customer activity rollups (quotes / projects live by id|name; a stored owner wins — D83) ---- */
  const rows = companyRollups(customers, quotes, projects);

  /* ---- filters, over EVERY company: scope, type, search (name, type, venues, and — in SQL — contacts' names,
     titles and emails), added in 7 days ---- */
  const contactHits = q.trim() ? await companyIdsWithContactMatching(q) : undefined;
  const { filtered, addedCount } = filterCompanyDirectory(rows, { scope, me: me.name, type: typeParam, q, added, contactHits });
  const ql = q.trim().toLowerCase();

  /* ---- drive-from-origin (#176, D229): one bulk lookup covering every
   *  customer's primary venue, then sort a COPY of `filtered` so nothing
   *  else (preAdded, the map pins below) is disturbed. Default (no sort)
   *  keeps today's store order exactly. ---- */
  const travel = await travelForPoints(
    customers.map((c) => {
      const l = primaryLoc(c.locations);
      return {
        id: c.id,
        lat: l?.lat,
        lng: l?.lng,
        city: l?.city,
        state: l?.state,
        travelMiles: l?.travelMiles,
        travelMin: l?.travelMin,
      };
    })
  );
  const sort = parseDriveSort(one(sp.sort));
  const sorted = sort
    ? [...filtered].sort(
        (a, b) =>
          compareDrive(travel.byId.get(a.c.id), travel.byId.get(b.c.id), sort) ||
          a.c.name.localeCompare(b.c.name)
      )
    : filtered;

  const paged = paginate(sorted, parsePageParam(one(sp.page)));
  const pageRows = paged.rows;
  const pageParams = pageParamsOf(sp);

  const types = ["all", ...Array.from(new Set(customers.map((c) => c.type).filter(Boolean)))];
  const ownerOptions = [
    { value: "all", label: "All teammates" },
    ...roster.map((p) => ({ value: p.name, label: p.name === me.name ? p.name + " (me)" : p.name })),
  ];

  const hasCustomers = customers.length > 0;
  const mapMode = view === "map";

  /* ---- map mode (Jeff's request, D-none): a slim VM for EVERY located
   *  venue of EVERY company — never the URL-filtered `filtered`/`sorted`
   *  above — shipped once to CompanyMapClient, which filters ~1,300 points
   *  in memory on every rail keystroke. List mode is untouched by this. */
  const mapPoints: CompanyMapPoint[] = [];
  let initialMapFilters: CompanyMapFilters = {
    q: "",
    type: "all",
    owner: "all",
    lifecycle: "all",
    tag: "all",
    drive: "",
    hasOpenQuotes: false,
  };
  if (mapMode) {
    rows.forEach(({ c, openValue, quoteCount, owner }) => {
      const d = travel.byId.get(c.id);
      const hasDrive = !!d && d.source !== "none" && d.miles != null;
      (c.locations || []).forEach((l) => {
        const co = coordsOf(l);
        if (!co) return;
        mapPoints.push({
          companyId: c.id,
          locId: l.id || "",
          lat: co.lat,
          lng: co.lng,
          name: c.name,
          type: c.type || "",
          owner,
          lifecycle: c.lifecycle || "none",
          keywords: c.keywords || [],
          venueLabel: l.label || "",
          city: l.city || "",
          state: l.state || "",
          driveMin: hasDrive ? d!.minutes : null,
          driveMiles: hasDrive ? d!.miles : null,
          openValue,
          quoteCount,
          addedAt: c.createdAt ?? 0,
        });
      });
    });
    // Carry over the filters list mode already has an equivalent control
    // for, so following "Map" from a filtered directory keeps the view
    // consistent (spec: "Map from a filtered list keeps the filters"). The
    // rail's other controls (lifecycle/tag/drive/open-quotes) have no list-
    // mode URL param to inherit and start unset.
    initialMapFilters = {
      q,
      type: typeParam,
      owner: scope || "all",
      lifecycle: "all",
      tag: "all",
      drive: "",
      hasOpenQuotes: false,
    };
  }

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
                {mapPoints.length} located venues
              </span>
            </div>
            <Link
              href="/companies"
              style={{ fontSize: 12.5, fontWeight: 600, color: "#3a3f4a", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px 13px", textDecoration: "none", whiteSpace: "nowrap" }}
            >
              Close map
            </Link>
          </div>
          <CompanyMapClient points={mapPoints} initialFilters={initialMapFilters} meName={me.name} ownerOptions={ownerOptions} />
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
            <FilterBar
              q={q}
              type={typeParam}
              scope={scope}
              added={added}
              addedCount={addedCount}
              types={types}
              ownerOptions={ownerOptions}
              meName={me.name}
              sort={sort}
              originName={travel.originName}
            />
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
            <>
            {sorted.length > 0 && (
              <div style={{ fontSize: 11.5, color: "#8c919c", marginBottom: 8 }}>
                Showing {paged.from}–{paged.to} of {paged.total}
              </div>
            )}
            <div className="pk-card" style={{ padding: 0, overflow: "hidden" }}>
              {pageRows.map(({ c, openValue, quoteCount, owner }) => {
                const ident = owner ? identOf(owner) : null;
                const venueN = (c.locations || []).length;
                const sub =
                  (c.type || "Customer") +
                  " · " +
                  custLocation(c) +
                  (venueN > 1 ? " · " + venueN + " venues" : "");
                const d = travel.byId.get(c.id);
                return (
                  <div key={c.id} className="cu-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: "1px solid #f5f6f8" }}>
                  <PopLink
                    href={customerPopUrl(c.id)}
                    popKind="customer"
                    popId={c.id}
                    style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12, textDecoration: "none", color: "inherit" }}
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
                    <span
                      className="cu-row-drive"
                      title={driveTitle(d, !!travel.originName)}
                      style={{
                        width: 110,
                        flexShrink: 0,
                        textAlign: "right",
                        fontFamily: "var(--font-mono)",
                        fontSize: 11.5,
                        color: d && d.source !== "none" ? "#3a3f4a" : "#b0b5bf",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fmtDrive(d)}
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
                  </PopLink>
                  {/* #278 — delete from the directory; same soft delete as the Edit dialog */}
                  {canDelete && <DeleteCompanyButton id={c.id} name={c.name} quoteCount={quoteCount} />}
                  </div>
                );
              })}
              {sorted.length === 0 && (
                <div style={{ padding: "50px 22px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
                  {ql ? `No companies match “${q.trim()}”.` : "No companies match these filters."}
                </div>
              )}
            </div>
            <ListPager
              page={paged.page}
              pageCount={paged.pageCount}
              total={paged.total}
              from={paged.from}
              to={paged.to}
              prevHref={paged.page > 1 ? withPage("/companies", pageParams, paged.page - 1) : null}
              nextHref={paged.page < paged.pageCount ? withPage("/companies", pageParams, paged.page + 1) : null}
              noun="companies"
            />
            </>
          )}
        </div>
      )}

      {edit === "new" && <EditCustomerModal mode="new" initial={null} fieldDefs={fieldDefs} venueTypes={venueTypes} closeHref="/companies" />}
    </>
  );
}

import Link from "next/link";
import { SearchFilterBar } from "@/components/search/search-filter-bar";
import { requireUser } from "@/lib/session";
import { loadVenueDirectory } from "@/lib/venue-history-server";
import { timeAgo } from "@/lib/format";
import { cityState, mono } from "../companies/lib";
import { travelForPoints } from "@/lib/travel-bulk";
import { compareDrive, driveTitle, fmtDrive, parseDriveSort } from "@/lib/drive-format";

/**
 * Venues directory (D101) — mirrors the Companies list's server-component +
 * searchParams-driven filter idiom (src/app/(app)/companies/page.tsx), but
 * stays single-file since this task only touches this new page: the search
 * box and company filter are a plain GET <form> (text input + native
 * <datalist>) instead of the companies page's separate client controls.tsx
 * (no debounced client state). Result-count cap + label follow /catalog's
 * own PAGE=200 pattern (punch #92, D142).
 */

export const metadata = { title: "Venues — Quartzite-6" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const CSS = `
  .ve-row:hover { background: #fafbff; }
  @media (max-width: 720px) {
    .ve-row-activity { display: none !important; }
    .ve-row-city { display: none !important; }
  }
`;

export default async function VenuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, rows] = await Promise.all([requireUser(), searchParams, loadVenueDirectory()]);

  const q = one(sp.q);

  /* ---- distinct companies present in the directory, for the company
   *  typeahead below (D142 — replaces a per-company chip list, which
   *  doesn't scale past a few dozen companies). ---- */
  const companyNames = new Map<string, string>();
  for (const r of rows) {
    if (!companyNames.has(r.site.companyId)) companyNames.set(r.site.companyId, r.companyName);
  }
  const companyOptions = Array.from(companyNames, ([id, name]) => ({ id, name })).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  // The company field accepts either a company id (old links, e.g. from a
  // venue or company record) or free-typed text picked from the datalist
  // below. A typed name that doesn't resolve to a known company fails open
  // to "no filter" rather than silently matching zero venues.
  const companyParam = one(sp.company).trim();
  let company = "";
  if (companyParam) {
    if (companyNames.has(companyParam)) {
      company = companyParam;
    } else {
      const byName = companyOptions.find((c) => c.name.toLowerCase() === companyParam.toLowerCase());
      company = byName ? byName.id : "";
    }
  }
  const activeCompanyName = company ? companyNames.get(company) : "";

  /* ---- filter ---- */
  const ql = q.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (company && r.site.companyId !== company) return false;
    if (ql) {
      const hay = (r.site.name + " " + r.companyName).toLowerCase();
      if (!hay.includes(ql)) return false;
    }
    return true;
  });

  /* ---- drive-from-origin (#176, D229): computed for ALL rows (not just the
   *  visible page) so nearest/farthest sort is correct across the whole set,
   *  before the PAGE cap below. ---- */
  const travel = await travelForPoints(
    rows.map((r) => ({
      id: r.site.id,
      lat: r.site.lat,
      lng: r.site.lng,
      city: r.site.city,
      state: r.site.state,
      travelMiles: r.site.travelMiles,
      travelMin: r.site.travelMin,
    }))
  );

  const sort = parseDriveSort(one(sp.sort));

  /* ---- sort: most recently active first by default; venues with no
   *  activity sort last (then by name, so the no-activity tail is still
   *  browsable). When a drive sort is chosen, order by drive distance
   *  instead, nearest/farthest first, unlocated last, then by name. ---- */
  if (sort) {
    filtered.sort(
      (a, b) =>
        compareDrive(travel.byId.get(a.site.id), travel.byId.get(b.site.id), sort) ||
        a.site.name.localeCompare(b.site.name)
    );
  } else {
    filtered.sort((a, b) => {
      if (a.lastActivity !== b.lastActivity) {
        if (a.lastActivity === null) return 1;
        if (b.lastActivity === null) return -1;
        return b.lastActivity - a.lastActivity;
      }
      return a.site.name.localeCompare(b.site.name);
    });
  }

  // The directory can hold thousands of venues; render only a page of them
  // so the DOM stays light (punch #92 — same cap-with-count-label default
  // already established by /catalog's PAGE constant, D142). Filters +
  // search narrow the set before the cap is applied.
  const PAGE = 200;
  const matchCount = filtered.length;
  const truncated = matchCount > PAGE;
  const visible = filtered.slice(0, PAGE);
  const resultLabel =
    (truncated ? `Showing ${PAGE} of ${matchCount}` : `${matchCount} of ${rows.length}`) +
    ` venue${matchCount === 1 ? "" : "s"}` +
    (activeCompanyName ? " · " + activeCompanyName : "") +
    (ql ? ` · “${q.trim()}”` : "") +
    (truncated ? " · refine with search or filters to narrow" : "") +
    (travel.originName
      ? ` · Drive from ${travel.originName}`
      : " · Set a quote origin with coordinates in Settings → Locations to see drive times");

  const linkWith = (patch: { company?: string; sort?: string }) => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    const nextCompany = patch.company !== undefined ? patch.company : company;
    if (nextCompany) p.set("company", nextCompany);
    const nextSort = patch.sort !== undefined ? patch.sort : sort;
    if (nextSort) p.set("sort", nextSort);
    const s = p.toString();
    return "/venues" + (s ? "?" + s : "");
  };

  const hasVenues = rows.length > 0;

  return (
    <div className="pk-content" style={{ maxWidth: 760, margin: "0 auto" }}>
      <style>{CSS}</style>

      <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 16 }}>
        <span style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Venues</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "#9aa0ab" }}>{rows.length}</span>
      </div>

      {hasVenues && (
        <div style={{ marginBottom: 14 }}>
          <form action="/venues" method="GET">
            {/* #121: search + the company filter on ONE row. `submit` keeps
                the magnifier as the form's submit button — with two text
                inputs and no button, Enter would not submit. */}
            {sort && <input type="hidden" name="sort" value={sort} />}
            <SearchFilterBar name="q" defaultValue={q} placeholder="Search venues…" ariaLabel="Search venues" submit>
              {companyOptions.length > 1 && (
                <>
                  {/* Company filter (D142) — a typeahead bound to a native
                   *  <datalist> rather than one option/chip per company, which
                   *  doesn't scale past a few dozen. Submits through the same
                   *  ?company= param as before; see the resolution above for how
                   *  a typed name (vs. an id from an old link) is handled. */}
                  <input
                    type="text"
                    name="company"
                    defaultValue={activeCompanyName}
                    list="ve-companies"
                    placeholder="Filter by company…"
                    aria-label="Filter by company"
                    className="pk-searchbar-select"
                    style={{ fontWeight: 500, cursor: "text", flex: "0 1 240px", minWidth: 160 }}
                  />
                  <datalist id="ve-companies">
                    {companyOptions.map((c) => (
                      <option key={c.id} value={c.name} />
                    ))}
                  </datalist>
                  {company && (
                    <Link href={linkWith({ company: "" })} style={{ fontSize: 12, fontWeight: 600, color: "#5b616e", whiteSpace: "nowrap", flexShrink: 0 }}>
                      Clear
                    </Link>
                  )}
                </>
              )}
            </SearchFilterBar>
          </form>

          <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 11 }}>{resultLabel}</div>

          {/* Sort (#176, D229) — recent activity (default) vs. drive distance
           *  from the quote origin, nearest/farthest first. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
            {(
              [
                { label: "Recent activity", value: "" },
                { label: "Nearest first", value: "near" },
                { label: "Farthest first", value: "far" },
              ] as const
            ).map((opt) => {
              const active = sort === opt.value;
              return (
                <Link
                  key={opt.value || "recent"}
                  href={linkWith({ sort: opt.value })}
                  style={{
                    fontSize: 11.5,
                    fontWeight: active ? 600 : 500,
                    padding: "4px 11px",
                    borderRadius: 20,
                    border: `1px solid ${active ? "var(--accent)" : "#e4e7ec"}`,
                    color: active ? "inherit" : "#5b616e",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  {opt.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {!hasVenues ? (
        <div className="pk-card" style={{ padding: "60px 30px", textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#3a3f4a" }}>No venues yet</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6 }}>
            Venues appear here once companies have locations on file.
          </div>
        </div>
      ) : (
        <div className="pk-card" style={{ padding: 0, overflow: "hidden" }}>
          {visible.map((row) => {
            const d = travel.byId.get(row.site.id);
            return (
              <Link
                key={row.site.id}
                href={"/venues/" + encodeURIComponent(row.site.id)}
                className="ve-row"
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" }}
              >
                <span style={{ width: 38, height: 38, borderRadius: 9, background: "#f1f2f5", color: "#5b616e", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12.5, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                  {mono(row.site.name)}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.site.name || "Untitled venue"}
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, color: "#8c919c", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.companyName}
                  </span>
                </span>
                <span className="ve-row-city" style={{ width: 130, flexShrink: 0, fontSize: 12.5, color: "#5b616e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {cityState({
                    city: row.city,
                    state: row.site.state ?? undefined,
                    primary: row.site.isPrimary,
                    venueKind: row.site.venueKind,
                    travelMiles: null,
                    travelMin: null,
                  }) || "—"}
                </span>
                <span
                  className="ve-row-drive"
                  title={driveTitle(d, !!travel.originName)}
                  style={{
                    width: 118,
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
                <span className="ve-row-activity" style={{ textAlign: "right", flexShrink: 0, fontSize: 12, color: "#9aa0ab", width: 64 }}>
                  {timeAgo(row.lastActivity)}
                </span>
              </Link>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: "50px 22px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
              {ql ? `No venues match “${q.trim()}”.` : "No venues match these filters."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

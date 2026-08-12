import Link from "next/link";
import { requireUser } from "@/lib/session";
import { loadVenueDirectory } from "@/lib/venue-history-server";
import { timeAgo } from "@/lib/format";
import { venueDirectoryPage } from "@/lib/venue-directory-page";
import { cityState, mono } from "../companies/lib";

/**
 * Venues directory (D101) — mirrors the Companies list's server-component +
 * searchParams-driven filter idiom (src/app/(app)/companies/page.tsx), but
 * stays single-file since this task only touches this new page: the search
 * box and company chips are a plain GET <form>/<Link> pair instead of the
 * companies page's separate client controls.tsx (no debounced client state).
 */

export const metadata = { title: "Venues — Quartzite-6" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const CSS = `
  .ve-row:hover { background: #fafbff; }
  @media (max-width: 720px) {
    .ve-row-activity { display: none !important; }
  }
`;

const PAGE_SIZE = 50;

export default async function VenuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, rows] = await Promise.all([requireUser(), searchParams, loadVenueDirectory()]);

  const q = one(sp.q);
  const company = one(sp.company);
  const requestedPage = Number.parseInt(one(sp.page), 10);

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

  /* ---- sort: most recently active first; venues with no activity sort last
   *  (then by name, so the no-activity tail is still browsable). ---- */
  filtered.sort((a, b) => {
    if (a.lastActivity !== b.lastActivity) {
      if (a.lastActivity === null) return 1;
      if (b.lastActivity === null) return -1;
      return b.lastActivity - a.lastActivity;
    }
    return a.site.name.localeCompare(b.site.name);
  });

  const result = venueDirectoryPage(filtered, requestedPage, PAGE_SIZE);

  const linkWith = (page: number) => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (company) p.set("company", company);
    if (page > 1) p.set("page", String(page));
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
          <form
            action="/venues"
            method="GET"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              background: "#fff",
              border: "1px solid #e4e7ec",
              borderRadius: 9,
              padding: "9px 12px",
            }}
          >
            {company && <input type="hidden" name="company" value={company} />}
            <button
              type="submit"
              aria-label="Search"
              style={{
                width: 14,
                height: 14,
                border: "1.7px solid #aab0bb",
                borderRadius: "50%",
                flexShrink: 0,
                position: "relative",
                background: "transparent",
                padding: 0,
                cursor: "pointer",
              }}
            >
              <span style={{ position: "absolute", right: -3, bottom: -3, width: 6, height: 1.7, background: "#aab0bb", transform: "rotate(45deg)" }} />
            </button>
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Search venues or companies…"
              style={{ flex: 1, border: "none", background: "transparent", fontSize: 13.5, fontFamily: "var(--font-ui)", color: "#16181d", outline: "none" }}
            />
          </form>

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
          {result.rows.map((row) => (
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
              <span style={{ width: 130, flexShrink: 0, fontSize: 12.5, color: "#5b616e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {cityState({
                  city: row.city,
                  state: row.site.state ?? undefined,
                  primary: row.site.isPrimary,
                  venueKind: row.site.venueKind,
                  travelMiles: null,
                  travelMin: null,
                }) || "—"}
              </span>
              <span className="ve-row-activity" style={{ textAlign: "right", flexShrink: 0, fontSize: 12, color: "#9aa0ab", width: 64 }}>
                {timeAgo(row.lastActivity)}
              </span>
            </Link>
          ))}
          {result.totalRows === 0 && (
            <div style={{ padding: "50px 22px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
              {ql ? `No venues match “${q.trim()}”.` : "No venues match these filters."}
            </div>
          )}
        </div>
      )}

      {result.totalRows > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, fontSize: 12.5, color: "#777d89" }}>
          <span>
            {result.totalRows > PAGE_SIZE
              ? `${(result.page - 1) * PAGE_SIZE + 1}–${Math.min(result.page * PAGE_SIZE, result.totalRows)} of ${result.totalRows}`
              : `${result.totalRows} venue${result.totalRows === 1 ? "" : "s"}`}
          </span>
          {result.totalPages > 1 && (
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {result.page > 1 ? <Link href={linkWith(result.page - 1)}>Previous</Link> : <span style={{ color: "#b5bac3" }}>Previous</span>}
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>Page {result.page} of {result.totalPages}</span>
              {result.page < result.totalPages ? <Link href={linkWith(result.page + 1)}>Next</Link> : <span style={{ color: "#b5bac3" }}>Next</span>}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

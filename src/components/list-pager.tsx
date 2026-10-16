import Link from "next/link";

/**
 * Prev / "Page X of Y" / Next under a directory list (Jeff 2026-10-15 #11).
 * A server component: plain links, so paging works without JavaScript and
 * the page lives in the URL (`?page=`). The caller builds the hrefs with
 * `withPage` (src/lib/list-paging.ts) so every filter carries over.
 */
export function ListPager({
  page,
  pageCount,
  total,
  from,
  to,
  prevHref,
  nextHref,
  noun = "rows",
}: {
  page: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
  prevHref: string | null;
  nextHref: string | null;
  noun?: string;
}) {
  if (total === 0) return null;
  const btn = (href: string | null, label: string, rel: "prev" | "next") =>
    href ? (
      <Link href={href} rel={rel} className="pk-btn-outline" data-testid={`list-pager-${rel}`} style={{ fontSize: 12.5, fontWeight: 600, textDecoration: "none", padding: "7px 13px", borderRadius: 8 }}>
        {label}
      </Link>
    ) : (
      <span aria-disabled="true" className="pk-btn-outline" style={{ fontSize: 12.5, fontWeight: 600, padding: "7px 13px", borderRadius: 8, opacity: 0.45, cursor: "default" }}>
        {label}
      </span>
    );
  return (
    <nav aria-label="Pages" data-testid="list-pager" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
      {btn(prevHref, "← Prev", "prev")}
      <span style={{ fontSize: 12, color: "#5b616e", whiteSpace: "nowrap" }}>
        Page <b style={{ fontFamily: "var(--font-mono)" }}>{page}</b> of <b style={{ fontFamily: "var(--font-mono)" }}>{pageCount}</b>
        <span style={{ color: "#9aa0ab" }}>
          {" "}· {from}–{to} of {total} {noun}
        </span>
      </span>
      {btn(nextHref, "Next →", "next")}
    </nav>
  );
}

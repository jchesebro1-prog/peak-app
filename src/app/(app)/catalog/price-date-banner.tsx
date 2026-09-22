"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { isoDateOf, parseEffectiveDate, type PriceBookRow } from "@/lib/catalog-books";
import { dateYear } from "@/lib/format";
import { setPriceListEffectiveAction } from "./actions";

export type BannerBook = PriceBookRow & {
  /** The manufacturer facet link, built by the page with its hrefFor(). */
  href: string;
  /** #122 — the vendor that claims this manufacturer, or null when unclaimed.
   *  Plain data resolved on the server; the row links it to /vendors/<id>. */
  vendor?: { id: string; name: string } | null;
};

/**
 * #133 — "price lists to check": manufacturers whose oldest effective price
 * date is 18+ months old, or that have no date at all. Each row's date input
 * writes settings.priceListEffective[key] — the manufacturer-level date that
 * dates every part of that book which has no newer price date of its own —
 * and the page re-renders without the row once the book is current. The
 * name applies the manufacturer facet filter.
 */
export function PriceDateBanner({ books }: { books: BannerBook[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!books.length) return null;
  const outdated = books.filter((b) => b.outdated).length;
  const unknown = books.length - outdated;

  const setDate = (book: BannerBook, iso: string) => {
    if (!iso) return;
    start(async () => {
      setError(null);
      const r = await setPriceListEffectiveAction(book.name, parseEffectiveDate(iso, Date.now()));
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <div style={{ background: "#fbf3dd", border: "1px solid #f0e2bd", borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#7a5f18" }}>
        Price lists to check — {outdated} outdated (over 18 months)
        {unknown ? `, ${unknown} without a date` : ""}. Set the date each list is effective, or import the current list.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {books.map((b) => (
          <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5 }}>
            <Link href={b.href} scroll={false} style={{ fontWeight: 600, color: "#5b4a12", textDecoration: "none" }}>
              {b.name}
            </Link>
            {b.vendor && (
              <Link
                href={`/vendors/${encodeURIComponent(b.vendor.id)}`}
                style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
              >
                {b.vendor.name} ›
              </Link>
            )}
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8a6d1f" }}>{b.count} parts</span>
            <span style={pill(b.outdated)}>{b.outdated ? `Outdated · effective ${dateYear(b.effectiveAt)}` : "No date"}</span>
            <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#7a5f18" }}>
              Price list effective
              <input
                type="date"
                defaultValue={b.effectiveAt ? isoDateOf(b.effectiveAt) : ""}
                disabled={pending}
                onChange={(e) => setDate(b, e.target.value)}
                style={{
                  border: "1px solid #e4d9b8",
                  borderRadius: 7,
                  padding: "5px 8px",
                  fontSize: 12,
                  fontFamily: "var(--font-ui)",
                  color: "#16181d",
                  background: "#fff",
                }}
              />
            </label>
          </div>
        ))}
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 11.5, color: "#b4543a" }}>{error}</div>}
    </div>
  );
}

function pill(outdated: boolean): React.CSSProperties {
  return {
    fontSize: 10.5,
    fontWeight: 600,
    borderRadius: 999,
    padding: "2px 8px",
    fontFamily: "var(--font-mono)",
    ...(outdated
      ? { color: "#b4543a", background: "#f7e9e5", border: "1px solid #f0d6cd" }
      : { color: "#5b616e", background: "#f1f2f5", border: "1px solid #e4e7ec" }),
  };
}

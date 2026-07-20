import Link from "next/link";
import { CardHeadTitle } from "./home-shared";

/**
 * Catalog glance card — parts count + price-book breakdown (PUNCHLIST #14).
 * Port of Home.dc.html's catalog widget; books are derived server-side from
 * the real catalog store (see priceBooks() in page.tsx) — that helper stays
 * in page.tsx since nothing but this one data-prep step calls it.
 */

export type PriceBook = { mono: string; name: string; count: number };

export default function HomeCatalog({
  books,
  partCount,
}: {
  books: PriceBook[];
  partCount: number;
}) {
  return (
    <div className="pk-card" style={{ padding: "16px 17px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 13,
        }}
      >
        <CardHeadTitle>Catalog</CardHeadTitle>
        <Link
          href="/catalog"
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--accent)",
            textDecoration: "none",
          }}
        >
          Manage →
        </Link>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 23, fontWeight: 600 }}>
          {partCount}
        </span>
        <span style={{ fontSize: 12.5, color: "#8c919c" }}>
          parts · {books.length} price book{books.length === 1 ? "" : "s"}
        </span>
      </div>
      {books.map((b) => {
        return (
          <div
            key={b.mono}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 0",
              borderTop: "1px solid #f3f4f7",
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: "#f1f2f5",
                color: "#3a3f4a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                flexShrink: 0,
              }}
            >
              {b.mono}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{b.name}</div>
              <div
                style={{ fontSize: 11, color: "#9aa0ab", fontFamily: "var(--font-mono)" }}
              >
                {b.count} parts
              </div>
            </div>
          </div>
        );
      })}
      {books.length === 0 && (
        <div style={{ padding: "14px 0 4px", fontSize: 12, color: "#9aa0ab" }}>
          No parts yet — import a price book from the Catalog screen.
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import type { PriceBookRow } from "@/lib/catalog-books";
import { dateYear } from "@/lib/format";
import { CardHeadTitle } from "./home-shared";

/**
 * Catalog glance card — parts count + price-book breakdown (PUNCHLIST #14,
 * #133). Port of Home.dc.html's catalog widget; books come from
 * priceBooks() in lib/catalog-books (pure), fed by the real catalog store
 * and the manufacturer-level price-list dates in settings (page.tsx does
 * that one data-prep step). Three pill states: an age ("3d ago") when the
 * book is fully dated and current, Outdated (oldest effective date is 18+
 * months old) and Unknown (some part has no effective date at all).
 */

const DAY = 86400000;

/** "3d ago" / "1d ago" / "today" */
function ageLabel(ageDays: number): string {
  if (ageDays <= 0) return "today";
  if (ageDays === 1) return "1d ago";
  return `${ageDays}d ago`;
}

const PILL: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  borderRadius: 999,
  padding: "3px 8px",
  fontFamily: "var(--font-mono)",
  flexShrink: 0,
};

function BookPill({ book, now }: { book: PriceBookRow; now: number }) {
  if (book.unknown) {
    return (
      <span
        style={{ ...PILL, color: "#8c919c", background: "#f1f2f5", border: "1px dashed #d5d9e0" }}
        title="No effective price-list date — set one on the Catalog screen"
      >
        Unknown
      </span>
    );
  }
  if (book.outdated) {
    return (
      <span
        style={{ ...PILL, color: "#b4543a", background: "#f7e9e5" }}
        title={`Oldest effective price date: ${dateYear(book.effectiveAt)} — over 18 months old`}
      >
        Outdated
      </span>
    );
  }
  const days = Math.floor((now - (book.effectiveAt ?? now)) / DAY);
  return (
    <span
      style={{ ...PILL, color: "#9aa0ab", background: "#f1f2f5" }}
      title={`Oldest effective price date in this price book: ${dateYear(book.effectiveAt)}`}
    >
      {ageLabel(days)}
    </span>
  );
}

export default function HomeCatalog({
  books,
  partCount,
}: {
  books: PriceBookRow[];
  partCount: number;
}) {
  const now = Date.now();
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
      {books.map((b) => (
        <div
          key={b.key || "unbranded"}
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
            <div style={{ fontSize: 11, color: "#9aa0ab", fontFamily: "var(--font-mono)" }}>
              {b.count} parts
            </div>
          </div>
          <BookPill book={b} now={now} />
        </div>
      ))}
      {books.length === 0 && (
        <div style={{ padding: "14px 0 4px", fontSize: 12, color: "#9aa0ab" }}>
          No parts yet — import a price book from the Catalog screen.
        </div>
      )}
    </div>
  );
}

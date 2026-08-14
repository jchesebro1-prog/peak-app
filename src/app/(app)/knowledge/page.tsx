import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";

export const metadata = { title: "Knowledge — Quartzite-6" };

/**
 * Knowledge hub — #56 (2026-08-14).
 * Top-level nav tab for company doctrine, design reference, and links to
 * estimating rules + reference libraries. Admins can edit; everyone can view.
 * Estimating Rules stay in /estimating-rules; this page links out to them.
 */

export default async function KnowledgePage() {
  const me = await requireUser();
  const isAdmin = can("manage_users", me.roles);

  return (
    <div className="pk-content" style={{ maxWidth: 900 }}>
      {/* header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em" }}>Knowledge</div>
          {isAdmin && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: ".06em",
                color: "#8a6d1f",
                background: "#fbf3dd",
                border: "1px solid #f0e2bd",
                padding: "3px 9px",
                borderRadius: 6,
              }}
            >
              ADMIN
            </span>
          )}
        </div>
        <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 4 }}>
          Company doctrine, design standards, and reference libraries.
        </div>
      </div>

      {/* cards grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
          gap: 16,
        }}
      >
        {/* Card 1: Design Doctrine */}
        <div className="pk-card" style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 3 }}>Design Doctrine</div>
              <div style={{ fontSize: 12.5, color: "#8c919c", lineHeight: 1.5 }}>
                Company design standards, preferred approaches, system design philosophy.
              </div>
            </div>
            {isAdmin && (
              <Link
                href="/knowledge/doctrine"
                style={{
                  flexShrink: 0,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--accent)",
                  background: "color-mix(in srgb, var(--accent) 10%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)",
                  borderRadius: 7,
                  padding: "5px 12px",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Edit
              </Link>
            )}
          </div>
          <div
            style={{
              marginTop: 14,
              padding: "14px 16px",
              background: "#f8f9fb",
              borderRadius: 8,
              border: "1px solid #eceef2",
              fontSize: 13,
              color: "#9aa0ab",
              fontStyle: "italic",
            }}
          >
            No doctrine written yet.
          </div>
        </div>

        {/* Card 2: Estimating Rules & Rates */}
        <div className="pk-card" style={{ padding: "20px 22px" }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 3 }}>Estimating Rules &amp; Rates</div>
          <div style={{ fontSize: 12.5, color: "#8c919c", lineHeight: 1.5, marginBottom: 16 }}>
            Labor rates, travel rates, service pricing, customer tier margins.
          </div>
          <Link
            href="/estimating-rules"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--accent)",
              textDecoration: "none",
            }}
          >
            Open Estimating Rules →
          </Link>
        </div>

        {/* Card 3: Motor Library */}
        <div className="pk-card" style={{ padding: "20px 22px" }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 3 }}>Motor Library</div>
          <div style={{ fontSize: 12.5, color: "#8c919c", lineHeight: 1.5, marginBottom: 16 }}>
            ETC compatible motor reference data.
          </div>
          <Link
            href="/design/motors"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--accent)",
              textDecoration: "none",
            }}
          >
            Open Motor Library →
          </Link>
        </div>

        {/* Card 4: Fixture Cross-Reference */}
        <div className="pk-card" style={{ padding: "20px 22px" }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 3 }}>Fixture Cross-Reference</div>
          <div style={{ fontSize: 12.5, color: "#8c919c", lineHeight: 1.5, marginBottom: 16 }}>
            ETC competitive fixture equivalence matrices.
          </div>
          <Link
            href="/design/fixtures"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--accent)",
              textDecoration: "none",
            }}
          >
            Open Fixture Cross-Ref →
          </Link>
        </div>
      </div>
    </div>
  );
}

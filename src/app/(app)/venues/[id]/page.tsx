import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import { getSite } from "@/lib/identity/sites";
import { getCompany } from "@/lib/identity/companies";
import { contactsForCompany, displayName } from "@/lib/identity/contacts";
import { CONTACT_STATUS_LABEL, type ContactStatus } from "@/lib/identity/config";
import { loadVenueHistory } from "@/lib/venue-history-server";
import type { VenueHistoryRow } from "@/lib/venue-match";
import { dateYear } from "@/lib/format";
import { fmtMiles, fmtTime } from "@/lib/geo";
import { ACCENT_INK, ACCENT_SOFT, cityState, mono, venueKindLabel } from "../../companies/lib";

/**
 * Venue detail (D101) — mirrors the `getX(id) → notFound() → getCompany(fk)`
 * shape and `.pk-card`/typography idiom of the companies/people detail pages
 * (src/app/(app)/companies/[id]/page.tsx, src/app/(app)/people/[id]/page.tsx).
 * Read-only: header (owning company, address, travel, primary flag), open
 * work pulled to the top, the full reverse-chronological history from
 * loadVenueHistory (already sorted newest-first, matched through docLocId so
 * migrated venues aren't silently empty — see venue-match.ts), and the owning
 * company's contacts.
 */

export const metadata = { title: "Venue — Quartzite-6" };

const card: CSSProperties = {
  background: "#fff",
  border: "1px solid #ececf0",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
  marginBottom: 24,
  overflow: "hidden",
};
const cardHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "14px 18px 12px",
  borderBottom: "1px solid #f0f1f4",
};

const CSS = `
  .ve-d-row:hover { background: #fafbff; }
`;

const STATUS_CHIP: Record<ContactStatus, { ink: string; soft: string }> = {
  active: { ink: "#1f7a52", soft: "#e7f4ee" },
  former: { ink: "#8c919c", soft: "#f1f2f5" },
  do_not_contact: { ink: "#b03a2e", soft: "#faece9" },
};

/** "bid_supported" -> "Bid supported" — the raw stage/status strings across
 *  the eight source stores don't share one vocabulary, so history rows show
 *  a humanized form rather than a per-kind status table. */
function humanizeStatus(s: string): string {
  const clean = s.replace(/_/g, " ").trim();
  return clean ? clean[0].toUpperCase() + clean.slice(1) : "—";
}

/** Open work gets the same "in progress" pill regardless of kind; closed/past
 *  work gets a neutral pill. Consistent with the app's blue=active, gray=done
 *  pill language (see companies/lib.ts QUOTE_STATUS_META). */
function historyPill(open: boolean): { ink: string; soft: string; bd: string } {
  return open
    ? { ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" }
    : { ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec" };
}

function HistoryRow({ r, showDate }: { r: VenueHistoryRow; showDate: boolean }) {
  const p = historyPill(r.open);
  return (
    <Link
      href={r.href}
      className="ve-d-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "13px 18px",
        borderBottom: "1px solid #f5f6f8",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      {showDate && (
        <span
          style={{
            width: 66,
            flexShrink: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: "#8c919c",
          }}
        >
          {dateYear(r.ts)}
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {r.title}
        </span>
        <span style={{ display: "block", fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
          {r.subtitle}
        </span>
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: p.ink,
          background: p.soft,
          border: `1px solid ${p.bd}`,
          padding: "2px 9px",
          borderRadius: 20,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {humanizeStatus(r.status)}
      </span>
    </Link>
  );
}

export default async function VenuePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const site = await getSite(id);
  if (!site) notFound();

  const [company, contacts, history] = await Promise.all([
    getCompany(site.companyId),
    contactsForCompany(site.companyId),
    loadVenueHistory(site),
  ]);

  const address =
    [
      site.address || "",
      cityState({
        city: site.city ?? undefined,
        state: site.state ?? undefined,
        primary: site.isPrimary,
        venueKind: site.venueKind,
        travelMiles: null,
        travelMin: null,
      }),
    ]
      .filter(Boolean)
      .join(" · ") || "—";

  // Corrupt/non-numeric travel data (Number(...) -> NaN) is treated as absent
  // per-field, rather than rendering "NaN mi" / "NaNh" for that field.
  const tMiles =
    site.travelMiles && site.travelMiles !== "" && !Number.isNaN(Number(site.travelMiles))
      ? Number(site.travelMiles)
      : null;
  const tMin =
    site.travelMin && site.travelMin !== "" && !Number.isNaN(Number(site.travelMin))
      ? Number(site.travelMin)
      : null;
  const hasTravel = tMiles != null || tMin != null;

  const openHistory = history.filter((r) => r.open);

  return (
    <div className="pk-content" style={{ maxWidth: 880 }}>
      <style>{CSS}</style>

      <Link
        href="/venues"
        style={{
          display: "inline-block",
          fontSize: 12.5,
          fontWeight: 600,
          color: "#8c919c",
          textDecoration: "none",
          marginBottom: 14,
        }}
      >
        ‹ All venues
      </Link>

      {/* header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
        <span
          style={{
            width: 54,
            height: 54,
            borderRadius: 13,
            background: "var(--accent)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 18,
            fontFamily: "var(--font-mono)",
            flexShrink: 0,
          }}
        >
          {mono(site.name)}
        </span>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>
              {site.name || "Untitled venue"}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#5b616e",
                background: "#f1f2f5",
                border: "1px solid #e4e7ec",
                padding: "2px 8px",
                borderRadius: 20,
              }}
            >
              {venueKindLabel(site.venueKind)}
            </span>
            {site.isPrimary && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: ACCENT_INK,
                  background: ACCENT_SOFT,
                  padding: "1px 6px",
                  borderRadius: 4,
                  letterSpacing: ".03em",
                }}
              >
                PRIMARY
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: "#8c919c", marginTop: 4 }}>
            <Link href={`/companies/${encodeURIComponent(site.companyId)}`} style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>
              {company?.name ?? site.companyId}
            </Link>
            {" · "}
            {address}
          </div>
          {hasTravel && (
            <div style={{ fontSize: 12, color: "#5b616e", marginTop: 6 }}>
              Travel
              {tMiles != null && (
                <>
                  {" · "}
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "#16181d" }}>{fmtMiles(tMiles)}</span>
                </>
              )}
              {tMin != null && (
                <>
                  {" · "}
                  {fmtTime(tMin)}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* open work */}
      {openHistory.length > 0 && (
        <div style={card}>
          <div style={cardHead}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>Open work</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>
              {openHistory.length}
            </span>
          </div>
          {openHistory.map((r) => (
            <HistoryRow key={"open-" + r.kind + "-" + r.id} r={r} showDate={false} />
          ))}
        </div>
      )}

      {/* history */}
      <div style={card}>
        <div style={cardHead}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>History</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{history.length}</span>
        </div>
        {history.map((r) => (
          <HistoryRow key={"hist-" + r.kind + "-" + r.id} r={r} showDate />
        ))}
        {history.length === 0 && (
          <div style={{ padding: "34px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            No work recorded at this venue yet.
          </div>
        )}
      </div>

      {/* contacts */}
      <div style={card}>
        <div style={cardHead}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Contacts</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{contacts.length}</span>
        </div>
        {contacts.map((c) => {
          const status = (c.status as ContactStatus) in STATUS_CHIP ? (c.status as ContactStatus) : "active";
          const chip = STATUS_CHIP[status];
          return (
            <Link
              key={c.id}
              href={`/people/${encodeURIComponent(c.id)}`}
              className="ve-d-row"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "13px 18px",
                borderBottom: "1px solid #f5f6f8",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{displayName(c)}</span>
                  {c.isPrimary && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: ACCENT_INK,
                        background: ACCENT_SOFT,
                        padding: "1px 6px",
                        borderRadius: 4,
                        letterSpacing: ".03em",
                      }}
                    >
                      PRIMARY
                    </span>
                  )}
                </span>
                {c.title && <span style={{ display: "block", fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>{c.title}</span>}
              </span>
              {status !== "active" && (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: chip.ink,
                    background: chip.soft,
                    borderRadius: 6,
                    padding: "3px 9px",
                    flexShrink: 0,
                  }}
                >
                  {CONTACT_STATUS_LABEL[status]}
                </span>
              )}
            </Link>
          );
        })}
        {contacts.length === 0 && (
          <div style={{ padding: "34px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            No contacts on file for this company.
          </div>
        )}
      </div>
    </div>
  );
}

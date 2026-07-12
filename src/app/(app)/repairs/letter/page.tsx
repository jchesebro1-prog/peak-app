import Link from "next/link";
import { requireUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";
import { locationById, nameFor } from "@/lib/stores/customers";
import {
  categoryMeta,
  priorityMeta,
  DEFAULT_WARRANTY_MONTHS,
} from "@/lib/stores/repair-jobs";
import { getSettings } from "@/lib/settings";
import { allUsers } from "@/lib/users";
import { AVG_MPH } from "@/lib/geo";
import { PrintButton } from "./controls";
import letterhead from "./peak-letterhead.jpg";

export const metadata = { title: "Repair letter — Peak Backend" };

/**
 * Repair quote LETTER — printable proposal cover letter for a saved repair
 * quote (repair twin of /flame-tests/letter, same .pk-doc-page foundation;
 * toolbar hidden by @media print). Deep-linked as /repairs/letter?id=<quoteId>.
 */

/* ---- display helpers (same as the flame letter) ---- */
function money(n: number | null | undefined): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}
function num1(n: number | null | undefined): string {
  const v = Math.round((+(n || 0)) * 10) / 10;
  return v.toLocaleString("en-US", {
    minimumFractionDigits: v % 1 ? 1 : 0,
    maximumFractionDigits: 1,
  });
}
function fmtDate(ms: number | null | undefined): string {
  const d = ms ? new Date(ms) : new Date();
  return d.getMonth() + 1 + "/" + d.getDate() + "/" + d.getFullYear();
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/* ---- repair quote subdoc shape (the payload Repair Quote saves) ---- */
type RpContact = { name?: string; role?: string; email?: string } | null;
type RpVenue = { id?: string | null; label?: string };
type RpItem = { label?: string; qty?: number; note?: string };
type RpPart = { name?: string; qty?: number; cost?: number };
type RepairDoc = {
  venues?: RpVenue[];
  contact?: RpContact;
  category?: string;
  priority?: string;
  scope?: string;
  source?: { kind?: string; refId?: string; label?: string } | null;
  items?: RpItem[];
  parts?: RpPart[];
  laborHours?: number;
  hoursEach?: number;
  crewSize?: number;
  emergency?: boolean;
  warrantyMonths?: number;
  office?: string;
  trip?: { miles?: number; minutes?: number } | null;
  total?: number | null;
};

const TOOLBAR_CSS = `
  .rpl-toolbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 18px; background: rgba(247,248,250,.92); backdrop-filter: blur(8px); border-bottom: 1px solid #e4e7ec; }
`;

export default async function RepairLetterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, settings] = await Promise.all([
    requireUser(),
    searchParams,
    getSettings(),
  ]);
  const accent = settings.accent || "#7b3f8a";
  const companyName = settings.companyName || "Peak Systems Group";
  const id = one(sp.id);

  const quote = id ? await getQuote(id) : null;
  const ok = !!(quote && quote.quoteType === "repair");

  /* -------- not found -------- */
  if (!ok || !quote) {
    return (
      <div style={{ minHeight: "100vh", fontFamily: "var(--font-ui)", color: "#16181d" }}>
        <style>{TOOLBAR_CSS}</style>
        <div className="rpl-toolbar pk-no-print">
          <Link
            href="/quotes"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              fontWeight: 600,
              color: "#8c919c",
              textDecoration: "none",
            }}
          >
            ← Quotes
          </Link>
        </div>
        <div
          style={{
            maxWidth: 520,
            margin: "60px auto",
            padding: 32,
            textAlign: "center",
            background: "#fff",
            border: "1px solid #ececf0",
            borderRadius: 14,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Quote not found</div>
          <div style={{ fontSize: 13, color: "#8c919c", lineHeight: 1.6 }}>
            This letter needs a saved repair quote. Open one from the Quotes list, or create a new
            repair quote first.
          </div>
          <Link
            href="/quotes"
            style={{
              display: "inline-block",
              marginTop: 16,
              fontSize: 13,
              fontWeight: 600,
              color: accent,
              textDecoration: "none",
            }}
          >
            Go to Quotes →
          </Link>
        </div>
      </div>
    );
  }

  const rp: RepairDoc = (quote.repair as RepairDoc) || {};
  const cat = categoryMeta(rp.category);
  const pm = priorityMeta(rp.priority);
  const emergency = !!rp.emergency || rp.priority === "emergency";

  const venueName =
    quote.customer || (await nameFor(quote.customerId)) || "the venue";

  /* per-venue locations (city/state resolved from the customer directory) */
  const venues = rp.venues || [];
  const locList = await Promise.all(
    venues.map(async (v) => {
      let city = "";
      let state = "";
      if (quote.customerId) {
        const loc = await locationById(quote.customerId, v.id ?? null);
        if (loc) {
          city = loc.city || "";
          state = loc.state || "";
        }
      }
      return {
        label: v.label || "Venue",
        place: [city, state].filter(Boolean).join(", "),
      };
    })
  );
  const single = locList.length === 1;
  const locationLabel = single
    ? locList[0].place || locList[0].label
    : locList.length + " venues";
  const hasVenueList = locList.length > 1;
  const venueListRows = locList.map(
    (v) => v.label + (v.place ? " — " + v.place : "")
  );

  /* scope + parts */
  const scopeItems = (rp.items || [])
    .map((i) => (i.label || "").trim())
    .filter(Boolean);
  const parts = (rp.parts || []).filter((p) => (p.name || "").trim());
  const notes = (rp.scope || "").trim();
  const fromInspection =
    rp.source && rp.source.kind === "inspection" && rp.source.refId
      ? rp.source.refId
      : "";

  /* narrative hours from stored trip + labor */
  const rtMiles = (rp.trip && rp.trip.miles) || 0;
  const oneWayMiles = rtMiles / 2;
  const mph = AVG_MPH || 50;
  const oneWayHours = mph ? oneWayMiles / mph : 0;
  const laborHours = rp.laborHours || 0;
  const crewSize = rp.crewSize || 1;
  const hoursEach = rp.hoursEach != null ? rp.hoursEach : crewSize ? laborHours / crewSize : laborHours;
  const originCity = rp.office || "our office";
  const travelParagraph =
    "The distance from " +
    companyName +
    " (" +
    originCity +
    ") to " +
    venueName +
    " is approximately " +
    num1(oneWayMiles) +
    " miles, or about " +
    num1(oneWayHours) +
    " hours each way. We estimate approximately " +
    num1(laborHours) +
    " crew-hour" +
    (laborHours === 1 ? "" : "s") +
    " on site" +
    (crewSize > 1
      ? " (" + num1(hoursEach) + " hours × crew of " + crewSize + ")"
      : "") +
    ".";

  const warrantyMonths =
    rp.warrantyMonths != null ? rp.warrantyMonths : DEFAULT_WARRANTY_MONTHS;
  const totalLabel = money(quote.value != null ? quote.value : rp.total || 0);

  const contact = (quote.contact as RpContact) || rp.contact || null;
  const greetingName = contact && contact.name ? contact.name : "Sir or Madam";

  const owner = quote.owner || "Jeff Chesebro";
  const users = await allUsers();
  const u = users.find((x) => x.name === owner) || null;
  const signerTitle = (u && u.roles && u.roles.length ? u.roles[0] : "") || "Estimator";
  const signerEmail = (u && u.email) || "";

  const dateLabel = fmtDate(quote.createdAt);
  const backHref = "/repairs/quote?id=" + encodeURIComponent(quote.id);

  const label = (t: string) => <span style={{ color: "#6b7079" }}>{t}</span>;

  return (
    <div style={{ minHeight: "100vh", fontFamily: "var(--font-ui)", color: "#16181d" }}>
      <style>{TOOLBAR_CSS}</style>

      {/* print-hidden toolbar */}
      <div className="rpl-toolbar pk-no-print">
        <Link
          href="/quotes"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12.5,
            fontWeight: 600,
            color: "#8c919c",
            textDecoration: "none",
          }}
        >
          ← Quotes
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <Link
            href={backHref}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "#8c919c",
              textDecoration: "none",
              padding: "8px 13px",
              border: "1px solid #e4e7ec",
              borderRadius: 9,
              background: "#fff",
            }}
          >
            Edit quote
          </Link>
          <PrintButton accent={accent} />
        </div>
      </div>

      {/* letter sheet */}
      <div style={{ padding: "26px 16px 60px" }}>
        <div className="pk-doc-page">
          <div style={{ fontFamily: "var(--font-ui)", fontSize: "11.5pt", lineHeight: 1.55, color: "#1a1c20" }}>
            {/* letterhead */}
            <div style={{ marginBottom: 26 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={letterhead.src}
                alt="Peak Systems Group, Inc."
                style={{ display: "block", width: "100%", height: "auto" }}
              />
              <div
                style={{
                  borderTop: "2px solid #16181d",
                  marginTop: 11,
                  paddingTop: 8,
                  display: "flex",
                  justifyContent: "flex-end",
                  alignItems: "baseline",
                  gap: 7,
                }}
              >
                <span
                  style={{
                    fontSize: "9pt",
                    fontWeight: 700,
                    color: accent,
                    letterSpacing: ".04em",
                    textTransform: "uppercase",
                  }}
                >
                  Repair Proposal
                </span>
                <span
                  style={{
                    fontSize: "8.5pt",
                    color: "#aab0bb",
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                  }}
                >
                  · {pm.long}
                </span>
              </div>
            </div>

            <div style={{ marginBottom: 3 }}>{label("Date:")} {dateLabel}</div>
            <div style={{ marginBottom: 3 }}>
              {label("Venue Name:")} <strong>{venueName}</strong>
            </div>
            <div style={{ marginBottom: 18 }}>{label("Location:")} {locationLabel}</div>

            <div style={{ marginBottom: 3 }}>
              {label("RE:")} {cat.label} repair at {venueName}
            </div>
            <div style={{ marginBottom: 16 }}>Dear {greetingName},</div>

            <p style={{ margin: "0 0 13px" }}>
              This proposal outlines the repair services {companyName} would perform at {venueName}
              {fromInspection
                ? ", addressing the findings identified during rigging inspection " +
                  fromInspection
                : ""}
              , outlined below:
            </p>

            {scopeItems.length > 0 && (
              <div style={{ margin: "0 0 14px" }}>
                <div
                  style={{
                    fontSize: "9pt",
                    fontWeight: 600,
                    color: "#6b7079",
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                    marginBottom: 6,
                  }}
                >
                  Scope of work
                </div>
                {scopeItems.map((text, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 3 }}>
                    <span style={{ color: "#aab0bb" }}>•</span>
                    <span>{text}</span>
                  </div>
                ))}
              </div>
            )}

            {notes && (
              <p
                style={{
                  margin: "0 0 14px",
                  fontSize: "10pt",
                  color: "#40454e",
                  padding: "10px 14px",
                  background: "#f6f7f9",
                  borderLeft: "3px solid #d6d9e0",
                  borderRadius: "0 6px 6px 0",
                  whiteSpace: "pre-wrap",
                }}
              >
                {notes}
              </p>
            )}

            {parts.length > 0 && (
              <div style={{ margin: "0 0 14px" }}>
                <div
                  style={{
                    fontSize: "9pt",
                    fontWeight: 600,
                    color: "#6b7079",
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                    marginBottom: 6,
                  }}
                >
                  Parts &amp; materials
                </div>
                {parts.map((p, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 3 }}>
                    <span style={{ color: "#aab0bb" }}>•</span>
                    <span>
                      {(p.qty || 1) + "× " + p.name}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {hasVenueList && (
              <div style={{ margin: "0 0 14px" }}>
                <div
                  style={{
                    fontSize: "9pt",
                    fontWeight: 600,
                    color: "#6b7079",
                    textTransform: "uppercase",
                    letterSpacing: ".05em",
                    marginBottom: 6,
                  }}
                >
                  Venues included
                </div>
                {venueListRows.map((text, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 3 }}>
                    <span style={{ color: "#aab0bb" }}>•</span>
                    <span>{text}</span>
                  </div>
                ))}
              </div>
            )}

            <p style={{ margin: "0 0 13px" }}>{travelParagraph}</p>

            {emergency && (
              <p
                style={{
                  margin: "0 0 13px",
                  fontSize: "10pt",
                  color: "#8a2f22",
                  padding: "10px 14px",
                  background: "#f4dcd6",
                  borderLeft: "3px solid #8a2f22",
                  borderRadius: "0 6px 6px 0",
                }}
              >
                This work is quoted at our emergency / after-hours service rate so a crew can be
                dispatched as soon as you approve.
              </p>
            )}

            <p style={{ margin: "0 0 4px" }}>
              <strong>The above services will cost {totalLabel}.</strong> Sales/Use taxes are not
              included.
            </p>
            <p style={{ margin: "0 0 13px", fontSize: "10pt", color: "#40454e" }}>
              Sales tax, if required, will be billed at the local sales tax rates in force at the
              time of billing.
            </p>
            <p style={{ margin: "0 0 18px", fontSize: "10pt", color: "#40454e" }}>
              All workmanship is covered by our {warrantyMonths}-month warranty from the date the
              repair is completed.
            </p>

            <p style={{ margin: "0 0 6px" }}>If you have any questions please contact me directly at:</p>
            <div style={{ marginTop: 16, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 600 }}>—{owner}</div>
              <div style={{ color: "#40454e" }}>{signerTitle}</div>
              {signerEmail && <div style={{ color: "#40454e" }}>{signerEmail}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";
import { locationById } from "@/lib/stores/customers";
import { nameFor } from "@/lib/stores/customers";
import { getSettings } from "@/lib/settings";
import { allUsers } from "@/lib/users";
import { AVG_MPH } from "@/lib/geo";
import { PrintButton } from "./controls";
import letterhead from "./peak-letterhead.jpg";

export const metadata = { title: "Flame test letter — Peak Backend" };

/**
 * Flame test quote LETTER — printable proposal for a saved flame-test
 * quote, on the .pk-doc-page foundation (white letter sheet; toolbar
 * hidden by @media print). Deep-linked as /flame-tests/letter?id=<quoteId>.
 *
 * D70 (Jeff, Jul 12): the prototype's Letter.dc.html was a pixel port of
 * an OLD imported Peak proposal kept as reference — this page now deviates
 * into a modern proposal document (title block, meta grid, price band,
 * visit-at-a-glance tiles) while keeping the same facts, figures, and the
 * load-bearing sentences the emailed PDF twin (lib/renewal-outreach.ts)
 * also composes.
 */

/* ---- prototype display helpers (Letter.dc.html money / num1) ---- */
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
function longDate(ms: number | null | undefined): string {
  return new Date(ms || Date.now()).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/* ---- flame-test quote subdoc shape (the payload Flame Test Quote saves) ---- */
type FtContact = { name?: string; role?: string; email?: string } | null;
type FtVenue = { id?: string | null; label?: string; curtains?: number };
type FlameTestDoc = {
  venues?: FtVenue[];
  curtainsTotal?: number | null;
  contact?: FtContact;
  origin?: {
    name?: string;
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
  trip?: { miles?: number; minutes?: number } | null;
  rates?: { curtainMinutes?: number } | null;
  total?: number | null;
};

const TOOLBAR_CSS = `
  .ftl-toolbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 18px; background: rgba(247,248,250,.92); backdrop-filter: blur(8px); border-bottom: 1px solid #e4e7ec; }
`;

export default async function FlameTestLetterPage({
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
  const ok = !!(quote && quote.quoteType === "flame_test");

  /* -------- not found -------- */
  if (!ok || !quote) {
    return (
      <div style={{ minHeight: "100vh", fontFamily: "var(--font-ui)", color: "#16181d" }}>
        <style>{TOOLBAR_CSS}</style>
        <div className="ftl-toolbar pk-no-print">
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
            This letter needs a saved flame-test quote. Open one from the Quotes list, or create a
            new flame test quote first.
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

  const ft: FlameTestDoc = (quote.flameTest as FlameTestDoc) || {};

  /* origin office → letterhead address + distance origin */
  const offices = Array.isArray(settings.offices) ? settings.offices : [];
  let origin = ft.origin;
  if (!origin || !(origin.city || origin.street)) {
    const o = offices[0] || ({} as (typeof offices)[number]);
    origin = {
      name: o.name || "",
      street: o.street || "",
      city: o.city || "",
      state: o.state || "",
      zip: o.zip || "",
    };
  }
  const originCity = origin.city || origin.name || "our office";

  const venueName =
    quote.customer || (await nameFor(quote.customerId)) || "the venue";

  /* per-venue locations (city/state resolved from the customer directory) */
  const venues = ft.venues || [];
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
        curtains: +(v.curtains || 0) || 0,
      };
    })
  );
  const single = locList.length === 1;
  const locationLabel = single
    ? locList[0].place || locList[0].label
    : locList.length + " venues";
  const hasVenueList = locList.length > 1;

  const curtainsTotal =
    ft.curtainsTotal != null
      ? ft.curtainsTotal
      : venues.reduce((a, v) => a + (+(v.curtains || 0) || 0), 0);
  const curtainsLabel = curtainsTotal + " curtain" + (curtainsTotal === 1 ? "" : "s");

  /* visit hours from stored trip + curtain testing time */
  const rtMiles = (ft.trip && ft.trip.miles) || 0;
  const oneWayMiles = rtMiles / 2;
  const mph = AVG_MPH || 50;
  const oneWayHours = mph ? oneWayMiles / mph : 0;
  const curtainMin = (ft.rates && ft.rates.curtainMinutes) || 5;
  const inspectionHours = (curtainsTotal * curtainMin) / 60;
  const totalHours = 2 * oneWayHours + inspectionHours;
  const hasTrip = rtMiles > 0;

  const totalLabel = money(quote.value != null ? quote.value : ft.total || 0);

  const contact = (quote.contact || ft.contact || null) as FtContact;
  const contactName = contact?.name || "";
  const contactRole = contact?.role || "";

  const owner = quote.owner || "Jeff Chesebro";
  const users = await allUsers();
  const u = users.find((x) => x.name === owner) || null;
  const signerTitle = (u && u.roles && u.roles.length ? u.roles[0] : "") || "Estimator";
  const signerEmail = (u && u.email) || "";

  const dateLabel = longDate(quote.createdAt);
  const backHref = "/flame-tests/quote?id=" + encodeURIComponent(quote.id);

  const accentSoft = `color-mix(in srgb, ${accent} 9%, #fff)`;
  const accentBd = `color-mix(in srgb, ${accent} 26%, #fff)`;
  const accentInk = `color-mix(in srgb, ${accent} 74%, #000)`;
  const microLabel = {
    color: "#8c919c",
    textTransform: "uppercase" as const,
    fontSize: "7.5pt",
    fontWeight: 600,
    letterSpacing: ".07em",
    marginBottom: 4,
  };

  return (
    <div style={{ minHeight: "100vh", fontFamily: "var(--font-ui)", color: "#16181d" }}>
      <style>{TOOLBAR_CSS}</style>

      {/* print-hidden toolbar */}
      <div className="ftl-toolbar pk-no-print">
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
          <div style={{ fontFamily: "var(--font-ui)", fontSize: "11pt", lineHeight: 1.55, color: "#1a1c20" }}>
            {/* letterhead — uploaded logo when set, baked sheet otherwise (D59 ladder) */}
            <div style={{ borderBottom: `3px solid ${accent}`, paddingBottom: 14, marginBottom: 20 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={settings.logoDark || letterhead.src}
                alt={companyName}
                style={
                  settings.logoDark
                    ? { display: "block", maxHeight: 76, maxWidth: "100%", objectFit: "contain" }
                    : { display: "block", width: "100%", height: "auto" }
                }
              />
            </div>

            {/* title block */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end",
                gap: 16,
                marginBottom: 20,
              }}
            >
              <div>
                <div style={{ fontSize: "19pt", fontWeight: 700, letterSpacing: "-.015em", lineHeight: 1.1 }}>
                  Flame Test Proposal
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "9pt",
                    color: accentInk,
                    marginTop: 6,
                  }}
                >
                  {quote.id} · NFPA 705 field flame testing
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: "9.5pt", color: "#5b616e" }}>
                {dateLabel}
              </div>
            </div>

            {/* meta grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr 1fr",
                gap: 18,
                marginBottom: 18,
                fontSize: "10pt",
              }}
            >
              <div>
                <div style={microLabel}>Prepared for</div>
                <div style={{ fontWeight: 600 }}>{venueName}</div>
                {contactName && (
                  <div style={{ color: "#5b616e" }}>
                    Attn: {contactName}
                    {contactRole ? " · " + contactRole : ""}
                  </div>
                )}
              </div>
              <div>
                <div style={microLabel}>Location</div>
                <div style={{ fontWeight: 600 }}>{locationLabel}</div>
              </div>
              <div>
                <div style={microLabel}>Scope</div>
                <div style={{ fontWeight: 600 }}>{curtainsLabel}</div>
                <div style={{ color: "#5b616e" }}>annual flame test</div>
              </div>
            </div>

            {/* price band */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 14,
                background: accentSoft,
                border: `1px solid ${accentBd}`,
                borderRadius: 8,
                padding: "11px 15px",
                marginBottom: 20,
              }}
            >
              <div>
                <div style={{ ...microLabel, color: accentInk, marginBottom: 1 }}>Total</div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "16pt",
                    fontWeight: 600,
                    letterSpacing: "-.01em",
                  }}
                >
                  {totalLabel}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: "9pt", color: "#5b616e", lineHeight: 1.6 }}>
                <div>
                  {curtainsLabel} · {locList.length > 1 ? locList.length + " venues" : "on-site testing"}
                </div>
                <div>plus applicable sales/use tax</div>
              </div>
            </div>

            {contactName && <div style={{ marginBottom: 12 }}>Dear {contactName},</div>}

            <p style={{ margin: "0 0 13px" }}>
              This proposal outlines the services {companyName} would perform for the annual flame
              test at {venueName} of roughly {curtainsLabel}, per NFPA 705 — Recommended Practice
              for a Field Flame Test, outlined below:
            </p>

            <p
              style={{
                margin: "0 0 16px",
                fontSize: "9.5pt",
                color: "#40454e",
                padding: "10px 14px",
                background: "#f7f8fa",
                borderLeft: `3px solid ${accentBd}`,
                borderRadius: "0 6px 6px 0",
              }}
            >
              NFPA 705 §1.1.1: This recommended practice provides guidance to enforcement officials
              for the field application of an open flame to textiles and films that have been in use
              in the field or for which reliable laboratory data are not available.
            </p>

            {hasVenueList && (
              <div style={{ margin: "0 0 16px" }}>
                <div style={microLabel}>Venues included</div>
                {locList.map((v, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 10,
                      padding: "5px 2px",
                      borderBottom: "1px solid #f0f1f4",
                      fontSize: "10pt",
                    }}
                  >
                    <span>
                      {v.label}
                      {v.place ? <span style={{ color: "#8c919c" }}> — {v.place}</span> : null}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "9pt", color: "#5b616e", flexShrink: 0 }}>
                      {v.curtains} curtain{v.curtains === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {hasTrip && (
              <div style={{ margin: "0 0 18px" }}>
                <div style={microLabel}>Your visit, at a glance</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  {[
                    {
                      label: "Travel each way",
                      value: num1(oneWayHours) + " hrs",
                      sub: num1(oneWayMiles) + " miles from " + originCity,
                    },
                    {
                      label: "On-site testing",
                      value: num1(inspectionHours) + " hrs",
                      sub: curtainsLabel + " tested",
                    },
                    {
                      label: "Total visit",
                      value: num1(totalHours) + " hrs",
                      sub: "door to door",
                    },
                  ].map((tile) => (
                    <div
                      key={tile.label}
                      style={{
                        border: "1px solid #ececf0",
                        borderRadius: 8,
                        padding: "9px 12px",
                      }}
                    >
                      <div style={{ ...microLabel, marginBottom: 2 }}>{tile.label}</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "12pt", fontWeight: 600 }}>
                        {tile.value}
                      </div>
                      <div style={{ fontSize: "8.5pt", color: "#8c919c", marginTop: 2 }}>{tile.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p style={{ margin: "0 0 4px" }}>
              <strong>The above services will cost {totalLabel}.</strong> Sales/Use taxes are not
              included.
            </p>
            <p style={{ margin: "0 0 20px", fontSize: "9.5pt", color: "#40454e" }}>
              Sales tax, if required, will be billed at the local sales tax rates in force at the
              time of billing.
            </p>

            {/* sign-off */}
            <div
              style={{
                borderTop: "1px solid #ececf0",
                paddingTop: 14,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end",
                gap: 14,
              }}
            >
              <div style={{ lineHeight: 1.5 }}>
                <div style={{ fontSize: "9.5pt", color: "#5b616e", marginBottom: 8 }}>
                  Questions? Contact me directly — we’re glad to adjust the scope.
                </div>
                <div style={{ fontWeight: 600 }}>{owner}</div>
                <div style={{ color: "#40454e", fontSize: "10pt" }}>
                  {signerTitle}
                  {signerEmail ? " · " + signerEmail : ""}
                </div>
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "8pt", color: "#aab0bb", flexShrink: 0 }}>
                {companyName} · {quote.id} · {dateLabel}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";
import { locationById, nameFor } from "@/lib/stores/customers";
import { levelMeta } from "@/lib/stores/inspections";
import { getSettings } from "@/lib/settings";
import { renderField } from "@/lib/templates";
import { allUsers } from "@/lib/users";
import { AVG_MPH } from "@/lib/geo";
import { PrintButton } from "./controls";
import letterhead from "./peak-letterhead.jpg";

export const metadata = { title: "Rigging Inspection — Quartzite" };

/**
 * Rigging Inspection PROPOSAL — printable work order for a saved
 * inspection quote (twin of /flame-tests/letter on the .pk-doc-page
 * foundation; toolbar hidden by @media print). Deep-linked as
 * /inspections/letter?id=<quoteId>.
 *
 * D72 (Jeff, Jul 12): reworked onto the same "Work Order 705" template as the
 * Field Flame Inspection proposal — a document-control header band (title +
 * SERVICE WORK ORDER subhead + ENGAGEMENT-FEE counterweight + control grid
 * with a LEVEL field), an ISSUED TO / ISSUED BY parties row, a line-item
 * SCOPE OF WORK table (inspect / mobilize / document, real per-row hours,
 * TOTAL footer), an OSHA/NFPA/ANSI E1 STANDARD callout + level-cadence note,
 * a bordered ENGAGEMENT FEE box with a punchy headline, and an authorization
 * block. Every inspection-specific fact is preserved (level cadence, the
 * standards, line-set counts, the re-inspection recommendation). The emailed
 * PDF twin (lib/renewal-outreach.ts) carries the same copy. Supersedes the
 * D71 title-block/meta-grid/tiles layout.
 */

/* ---- display helpers (money / num1 / dates) ---- */
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
function isoDate(ms: number | null | undefined): string {
  const d = new Date(ms || Date.now());
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
/** ms + N days, tolerating a null base (kept module-level so the Date.now()
    fallback stays out of the component body / the react purity rule). */
function addDays(ms: number | null | undefined, days: number): number {
  return (ms || Date.now()) + days * 86400000;
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/* ---- inspection quote subdoc shape (the payload Inspection Quote saves) ---- */
type InContact = { name?: string; role?: string; email?: string } | null;
type InVenue = { id?: string | null; label?: string; lineSets?: number };
type InspectionDoc = {
  level?: number;
  scope?: string;
  venues?: InVenue[];
  contact?: InContact;
  office?: string;
  lineSetsTotal?: number;
  inspectHours?: number;
  trip?: { miles?: number; minutes?: number } | null;
  total?: number | null;
};

const TOOLBAR_CSS = `
  .inl-toolbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 18px; background: rgba(247,248,250,.92); backdrop-filter: blur(8px); border-bottom: 1px solid #e4e7ec; }
`;

/* The .pk-doc-page base is Georgia serif and the app's --font-ui/--font-mono
   design tokens don't cascade into it — the work order opts into the app's
   clean sans for body/labels and a true mono for every figure, id, and hour,
   self-contained so it renders right on-screen and near the Helvetica PDF. */
const SANS = 'var(--font-ui, "Public Sans"), system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = 'var(--font-mono, "IBM Plex Mono"), ui-monospace, SFMono-Regular, Menlo, monospace';

export default async function InspectionLetterPage({
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
  const ok = !!(quote && quote.quoteType === "inspection");

  /* -------- not found -------- */
  if (!ok || !quote) {
    return (
      <div style={{ minHeight: "100vh", fontFamily: SANS, color: "#16181d" }}>
        <style>{TOOLBAR_CSS}</style>
        <div className="inl-toolbar pk-no-print">
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
            This work order needs a saved rigging-inspection quote. Open one from the Quotes list,
            or create a new inspection quote first.
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

  const insp: InspectionDoc = (quote.inspection as InspectionDoc) || {};
  const lm = levelMeta(insp.level);
  const cadence =
    lm.key === 2 ? "an in-depth Level 2 rigging inspection" : "the annual Level 1 rigging inspection";

  const venueName =
    quote.customer || (await nameFor(quote.customerId)) || "the venue";

  /* per-venue locations (city/state resolved from the customer directory) */
  const venues = insp.venues || [];
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
        lineSets: +(v.lineSets || 0) || 0,
      };
    })
  );
  const hasVenueList = locList.length > 1;

  const lineSetsTotal =
    insp.lineSetsTotal != null
      ? insp.lineSetsTotal
      : venues.reduce((a, v) => a + (+(v.lineSets || 0) || 0), 0);
  const lineSetsLabel = lineSetsTotal + " line set" + (lineSetsTotal === 1 ? "" : "s");
  const scope = (insp.scope || "").trim();

  /* visit hours from stored trip + inspection time */
  const rtMiles = (insp.trip && insp.trip.miles) || 0;
  const mph = AVG_MPH || 50;
  const oneWayHours = mph ? rtMiles / 2 / mph : 0;
  const inspectHours = insp.inspectHours || 0;
  const travelHours = 2 * oneWayHours;
  const totalHours = travelHours + inspectHours;
  const originCity = insp.office || "our office";
  const hasTrip = rtMiles > 0;

  const totalLabel = money(quote.value != null ? quote.value : insp.total || 0);

  const contact = (quote.contact as InContact) || insp.contact || null;
  const contactName = contact?.name || "";
  const contactRole = contact?.role || "";

  const owner = quote.owner || "Jeff Chesebro";
  const users = await allUsers();
  const u = users.find((x) => x.name === owner) || null;
  const signerTitle = (u && u.roles && u.roles.length ? u.roles[0] : "") || "Estimator";
  const signerEmail = (u && u.email) || "";

  const backHref = "/inspections/quote?id=" + encodeURIComponent(quote.id);

  /* ---- work-order derived values (Work Order 705, D72) ---- */
  const accentInk = `color-mix(in srgb, ${accent} 74%, #000)`;
  const accentTint12 = `color-mix(in srgb, ${accent} 12%, #fff)`;
  const accentFaint = `color-mix(in srgb, ${accent} 6%, #fff)`;
  const ctrlLabel = {
    fontSize: "8pt",
    letterSpacing: ".08em",
    textTransform: "uppercase" as const,
    color: "#8c919c",
    fontWeight: 600,
  };

  const validThruMs = addDays(quote.createdAt, 30);
  const validThruLabel = longDate(validThruMs);
  const controlFields: Array<{ k: string; v: string }> = [
    { k: "Document", v: quote.id },
    { k: "Issued", v: isoDate(quote.createdAt) },
    { k: "Valid through", v: isoDate(validThruMs) },
    { k: "Level", v: lm.label },
    { k: "Rev", v: "—" },
    { k: "Sheet", v: "1 of 1" },
  ];

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const scopeRows: Array<{ item: string; desc: string; sub?: string; qty: string; hours: string }> =
    [];
  let sr = 1;
  scopeRows.push({
    item: pad2(sr++),
    desc:
      "Inspect every accessible rigging component in place, per OSHA / NFPA / ANSI E1" +
      (hasVenueList ? " across " + locList.length + " venues" : ""),
    qty: lineSetsLabel,
    hours: num1(inspectHours) + " hrs",
  });
  if (hasTrip) {
    scopeRows.push({
      item: pad2(sr++),
      desc: "Round-trip site mobilization from " + originCity,
      qty: Math.round(rtMiles) + " mi rt",
      hours: num1(travelHours) + " hrs",
    });
  }
  scopeRows.push({
    item: pad2(sr++),
    desc: "Document & prioritize findings (Urgent / Necessary / Basic); issue written report with photos",
    qty: "1 report",
    hours: "incl.",
  });

  const tpl = settings.templates;
  const introSentence = renderField(tpl, "inspection_proposal", "intro", {
    company: companyName,
    venue: venueName,
    cadence,
  });
  const standardsQuote = renderField(tpl, "inspection_proposal", "standardsQuote", {});
  const cadenceNote = renderField(
    tpl,
    "inspection_proposal",
    lm.key === 2 ? "cadenceNoteL2" : "cadenceNoteL1",
    {}
  );
  const priceHeadline = renderField(
    tpl,
    "inspection_proposal",
    hasTrip ? "priceLine" : "priceLineNoTravel",
    { lineSetsLabel, price: totalLabel }
  );
  const priceSupport = renderField(tpl, "inspection_proposal", "costTail", {});
  const signoffCta = renderField(tpl, "inspection_proposal", "signoff", {});

  const cellPad = "9px 11px";

  return (
    <div style={{ minHeight: "100vh", fontFamily: SANS, color: "#111" }}>
      <style>{TOOLBAR_CSS}</style>

      {/* print-hidden toolbar */}
      <div className="inl-toolbar pk-no-print">
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

      {/* work-order sheet */}
      <div style={{ padding: "26px 16px 60px" }}>
        <div className="pk-doc-page">
          <div style={{ fontFamily: SANS, fontSize: "11pt", lineHeight: 1.5, color: "#111" }}>
            {/* 1) letterhead + accent hairline */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={settings.logoDark || letterhead.src}
              alt={companyName}
              style={
                settings.logoDark
                  ? { display: "block", maxHeight: 64, maxWidth: "100%", objectFit: "contain" }
                  : { display: "block", width: "100%", height: "auto" }
              }
            />
            <div style={{ height: 1, background: accent, marginTop: 12, marginBottom: 18 }} />

            {/* 2) document-control header band */}
            <div style={{ display: "flex", border: "1px solid #cfcfcf" }}>
              <div
                style={{
                  flex: "0 0 58%",
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 18,
                  borderRight: "1px solid #cfcfcf",
                }}
              >
                <div>
                  <div style={{ fontSize: "23pt", fontWeight: 600, letterSpacing: "-.01em", lineHeight: 1.05 }}>
                    Rigging Inspection
                  </div>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: "8pt",
                      letterSpacing: ".1em",
                      textTransform: "uppercase",
                      color: "#8c919c",
                      marginTop: 7,
                    }}
                  >
                    Service Work Order · {lm.long}
                  </div>
                </div>
                <div style={{ marginTop: "auto" }}>
                  <div style={{ ...ctrlLabel, fontSize: "7.5pt", color: accentInk, marginBottom: 3 }}>
                    Engagement fee
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontFamily: MONO, fontSize: "27pt", fontWeight: 600, letterSpacing: "-.02em" }}>
                      {totalLabel}
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: "8pt", color: "#9aa0ab", letterSpacing: ".08em" }}>
                      USD
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ flex: "1 1 42%", display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                {controlFields.map((f, i) => (
                  <div
                    key={f.k}
                    style={{
                      padding: "10px 12px",
                      borderBottom: i < 4 ? "1px solid #e4e7ec" : "none",
                      borderLeft: i % 2 ? "1px solid #e4e7ec" : "none",
                    }}
                  >
                    <div style={{ ...ctrlLabel, fontSize: "7pt", color: "#9aa0ab", marginBottom: 3 }}>
                      {f.k}
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: "9.5pt", color: "#111" }}>{f.v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3) parties row */}
            <div style={{ display: "flex", border: "1px solid #cfcfcf", borderTop: "none", marginBottom: 24 }}>
              <div style={{ flex: "1 1 50%", padding: "13px 16px", borderRight: "1px solid #cfcfcf" }}>
                <div style={ctrlLabel}>Issued to</div>
                <div style={{ fontWeight: 600, marginTop: 5 }}>{venueName}</div>
                {contactName && (
                  <div style={{ color: "#5b616e", fontSize: "10pt" }}>
                    {contactName}
                    {contactRole ? " · " + contactRole : ""}
                  </div>
                )}
                {locList.map((v, i) => (
                  <div key={i} style={{ color: "#5b616e", fontSize: "9.5pt", marginTop: 2 }}>
                    {v.label}
                    {v.place ? " — " + v.place : ""}
                    {hasVenueList ? " · " + v.lineSets + " line set" + (v.lineSets === 1 ? "" : "s") : ""}
                  </div>
                ))}
              </div>
              <div style={{ flex: "1 1 50%", padding: "13px 16px" }}>
                <div style={ctrlLabel}>Issued by</div>
                <div style={{ fontWeight: 600, marginTop: 5 }}>{companyName}</div>
                <div style={{ color: "#5b616e", fontSize: "9.5pt" }}>Mobilizing from {originCity}</div>
                <div style={{ color: "#5b616e", fontSize: "10pt", marginTop: 2 }}>
                  {owner}
                  {signerTitle ? " · " + signerTitle : ""}
                </div>
                {signerEmail && <div style={{ color: "#5b616e", fontSize: "9.5pt" }}>{signerEmail}</div>}
              </div>
            </div>

            {/* 4) scope of work */}
            <div style={{ marginBottom: 20 }}>
              <div
                style={{
                  display: "inline-block",
                  fontSize: "10pt",
                  fontWeight: 700,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: accentInk,
                  borderBottom: `1px solid ${accent}`,
                  paddingBottom: 3,
                }}
              >
                Scope of work
              </div>
              <p style={{ margin: "12px 0 14px", fontSize: "10.5pt", color: "#3a3f4a", lineHeight: 1.6 }}>
                {introSentence}
              </p>
              {scope && (
                <p style={{ margin: "0 0 14px", fontSize: "9.5pt", color: "#5b616e", lineHeight: 1.55 }}>
                  <span style={{ ...ctrlLabel, fontSize: "8pt", marginRight: 6 }}>Scope notes</span>
                  {scope}
                </p>
              )}
              <div style={{ border: "1px solid #cfcfcf" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "8% 56% 18% 18%",
                    background: accentTint12,
                    borderBottom: "1px solid #cfcfcf",
                  }}
                >
                  {["Item", "Description", "Qty / Basis", "Hours"].map((h, i) => (
                    <div
                      key={h}
                      style={{
                        padding: "7px 11px",
                        fontSize: "7.5pt",
                        letterSpacing: ".07em",
                        textTransform: "uppercase",
                        fontWeight: 700,
                        color: accentInk,
                        textAlign: i >= 2 ? "right" : "left",
                      }}
                    >
                      {h}
                    </div>
                  ))}
                </div>
                {scopeRows.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "8% 56% 18% 18%",
                      borderBottom: i < scopeRows.length - 1 ? "1px solid #f0f1f4" : "none",
                      alignItems: "baseline",
                    }}
                  >
                    <div style={{ padding: cellPad, fontFamily: MONO, fontSize: "9pt", color: "#9aa0ab" }}>
                      {r.item}
                    </div>
                    <div style={{ padding: cellPad, fontSize: "10pt" }}>
                      {r.desc}
                      {r.sub && (
                        <span style={{ display: "block", fontSize: "8.5pt", color: "#8c919c", marginTop: 2 }}>
                          {r.sub}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        padding: cellPad,
                        fontFamily: MONO,
                        fontSize: "9pt",
                        color: "#5b616e",
                        textAlign: "right",
                      }}
                    >
                      {r.qty}
                    </div>
                    <div
                      style={{
                        padding: cellPad,
                        fontFamily: MONO,
                        fontSize: "9pt",
                        color: "#111",
                        fontWeight: 600,
                        textAlign: "right",
                      }}
                    >
                      {r.hours}
                    </div>
                  </div>
                ))}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    padding: "8px 11px",
                    borderTop: "1px solid #cfcfcf",
                    background: "#fbfbfc",
                  }}
                >
                  <span style={{ fontFamily: MONO, fontSize: "8.5pt", letterSpacing: ".04em", color: "#5b616e" }}>
                    TOTAL ON-SITE + TRAVEL — {num1(totalHours)} HRS
                  </span>
                </div>
              </div>
            </div>

            {/* 5) standard & deliverable callout + cadence note */}
            <div
              style={{
                borderLeft: `3px solid ${accent}`,
                background: accentFaint,
                padding: "9px 13px",
                marginBottom: 10,
                fontSize: "9.5pt",
                color: "#40454e",
                lineHeight: 1.55,
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: "8pt",
                  letterSpacing: ".07em",
                  textTransform: "uppercase",
                  color: accentInk,
                  marginRight: 8,
                }}
              >
                Standard
              </span>
              {standardsQuote}
            </div>
            <div style={{ fontSize: "9pt", color: "#8c919c", marginBottom: 22, lineHeight: 1.5 }}>
              {cadenceNote}
            </div>

            {/* 6) engagement fee box */}
            <div
              style={{
                border: `1.5px solid ${accent}`,
                borderTop: `3px solid ${accent}`,
                borderRadius: 2,
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 18,
                marginBottom: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...ctrlLabel, color: accentInk, fontWeight: 700, marginBottom: 5 }}>
                  Engagement fee
                </div>
                <div style={{ fontSize: "11pt", fontWeight: 600, color: "#111", lineHeight: 1.45 }}>
                  {priceHeadline}
                </div>
                <div style={{ fontSize: "9pt", color: "#8c919c", marginTop: 6, lineHeight: 1.5 }}>
                  {priceSupport}
                </div>
              </div>
              <div style={{ flexShrink: 0, display: "flex", alignItems: "baseline", gap: 5 }}>
                <span style={{ fontFamily: MONO, fontSize: "34pt", fontWeight: 600, letterSpacing: "-.02em", color: "#111" }}>
                  {totalLabel}
                </span>
                <span style={{ fontFamily: MONO, fontSize: "9pt", color: "#9aa0ab", letterSpacing: ".08em" }}>
                  USD
                </span>
              </div>
            </div>

            {/* 7) authorization / sign-off */}
            <div style={{ borderTop: "1px solid #cfcfcf", marginTop: 22, paddingTop: 16 }}>
              <p style={{ margin: "0 0 18px", fontSize: "10pt", color: "#3a3f4a", lineHeight: 1.6 }}>
                {signoffCta}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
                <div>
                  <div style={ctrlLabel}>Prepared by</div>
                  <div style={{ fontWeight: 600, marginTop: 6 }}>{owner}</div>
                  <div style={{ color: "#5b616e", fontSize: "9.5pt" }}>{signerTitle}</div>
                  {signerEmail && <div style={{ color: "#5b616e", fontSize: "9.5pt" }}>{signerEmail}</div>}
                </div>
                <div>
                  <div style={ctrlLabel}>Authorized to proceed</div>
                  <div style={{ borderBottom: "1px solid #9aa0ab", height: 30 }} />
                  <div style={{ fontSize: "8pt", color: "#9aa0ab", marginTop: 3 }}>Signature · print name</div>
                  <div style={{ borderBottom: "1px solid #9aa0ab", height: 24, marginTop: 14 }} />
                  <div style={{ fontSize: "8pt", color: "#9aa0ab", marginTop: 3 }}>Date</div>
                </div>
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: "7.5pt",
                  color: "#aab0bb",
                  marginTop: 20,
                  letterSpacing: ".02em",
                }}
              >
                Work Order {quote.id} · Valid through {validThruLabel} · This work order constitutes a
                proposal valid for 30 days from issue.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

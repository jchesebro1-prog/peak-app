import { fmtLong } from "@/lib/stores/flame-jobs";
import { renderField } from "@/lib/templates";
import type { TemplateOverrides } from "@/lib/templates";
import letterhead from "./peak-letterhead.jpg";

/**
 * Field Flame Inspection report document body — the three printable variants
 * (letter / summary / certificate) from Flame Test Report.dc.html, rendered on
 * the .pk-doc-page foundation. Shared by the live report (report/page.tsx) and
 * the three-up comparison (report/options/page.tsx).
 *
 * D72 rebrand: the SERVICE/deliverable is "Field Flame Inspection"; the NFPA
 * 705 standard name and the physical field-flame-test method phrases stay
 * verbatim (they're what the AHJ expects on a compliance record).
 *
 * buildReportModel() is the pure port of the .dc.html renderVals(); ReportBody
 * renders the resolved model for the active variant.
 */

export type ReportVariant = "letter" | "summary" | "certificate";

/* ---- loose job shape (accepts a real FlameJob or the options sample) ---- */
type ResultVenue = {
  id?: string | null;
  label?: string;
  tested?: number | null;
  passed?: number | null;
  retreated?: number | null;
  failed?: number | null;
};
type JobVenue = {
  id?: string | null;
  label?: string;
  city?: string;
  state?: string;
  curtains?: number;
};
export type ReportJob = {
  id?: string;
  customer?: string;
  venue?: string;
  owner?: string;
  assignedTo?: string;
  completedAt?: number | null;
  dueAt?: number | null;
  stage?: string;
  contact?: { name?: string } | null;
  venues?: JobVenue[];
  results?: {
    overall?: string;
    cert?: string;
    performedBy?: string;
    notes?: string;
    venues?: ResultVenue[];
  } | null;
};

export type OrgCtx = {
  accent: string;
  companyName: string;
  offices: Array<{ city?: string; phone?: string }>;
  users: Array<{ name: string; roles: string[] | null; email: string }>;
  /** Uploaded dark brand mark (Settings → Branding, IDEAS #32) — replaces the
   *  baked-in letterhead image when present. */
  letterhead?: string | null;
  /** Admin template-wording overrides (settings.templates); resolved against
   *  the `flame_report` template for the editable report prose. */
  templates?: TemplateOverrides;
};

type Row = {
  label: string;
  place: string;
  tested: number;
  passed: number;
  retreated: number;
  failed: number;
};

const YEAR = 365 * 86400000;

function rows(job: ReportJob): Row[] {
  const res = job.results || {};
  const rById: Record<string, ResultVenue> = {};
  (res.venues || []).forEach((v) => {
    if (v.id != null) rById[v.id] = v;
  });
  const base =
    job.venues && job.venues.length ? job.venues : ((res.venues || []) as JobVenue[]);
  return base.map((v) => {
    const rv: ResultVenue & JobVenue = { ...(v.id != null ? rById[v.id] : undefined), ...v };
    const tested = rv.tested != null ? +rv.tested || 0 : +(v.curtains || 0) || 0;
    const passed = rv.passed != null ? +rv.passed || 0 : +(v.curtains || 0) || 0;
    const retreated = +(rv.retreated || 0) || 0;
    const failed =
      rv.failed != null ? +rv.failed || 0 : Math.max(0, tested - passed - retreated);
    return {
      label: v.label || rv.label || "Venue",
      place: [v.city, v.state].filter(Boolean).join(", "),
      tested,
      passed,
      retreated,
      failed,
    };
  });
}

function narrative(
  t: { tested: number; passed: number; retreated: number; failed: number },
  goodThrough: string
): string {
  const cur = (n: number) => n + " curtain" + (n === 1 ? "" : "s");
  const tags = t.passed + t.retreated;
  const tagLine =
    tags +
    " new flame tag" +
    (tags === 1 ? " was" : "s were") +
    " applied, and every certified curtain is labeled for this year’s inspection — good through " +
    goodThrough +
    ".";
  if (t.failed === 0 && t.retreated === 0) {
    return (
      "The test revealed that all " +
      cur(t.passed) +
      " passed the field flame test as flame retardant. " +
      tagLine
    );
  }
  if (t.failed === 0) {
    return (
      "The test revealed that all " +
      cur(t.tested) +
      " are flame retardant — " +
      t.passed +
      " passed the field flame test and " +
      t.retreated +
      " " +
      (t.retreated === 1 ? "is" : "are") +
      " inherently flame retardant (IFR), needing no treatment. " +
      tagLine
    );
  }
  const passSummary =
    t.passed +
    " passed the field flame test" +
    (t.retreated
      ? " and " + t.retreated + " " + (t.retreated === 1 ? "is" : "are") + " inherently flame retardant (IFR)"
      : "");
  return (
    "Of the " +
    cur(t.tested) +
    " tested, " +
    passSummary +
    "; the remaining " +
    t.failed +
    " did not pass and require re-treatment with an approved flame retardant or replacement before they can be certified. The " +
    tags +
    " compliant curtain" +
    (tags === 1 ? " was" : "s were") +
    " tagged and certified through " +
    goodThrough +
    ". We recommend scheduling follow-up treatment at your earliest convenience."
  );
}

export type ReportModel = ReturnType<typeof buildReportModel>;

export function buildReportModel(job: ReportJob, org: OrgCtx) {
  const res = job.results || {};
  const rws = rows(job);
  const t = rws.reduce(
    (a, r) => ({
      tested: a.tested + r.tested,
      passed: a.passed + r.passed,
      retreated: a.retreated + r.retreated,
      failed: a.failed + r.failed,
    }),
    { tested: 0, passed: 0, retreated: 0, failed: 0 }
  );

  const completedAt = job.completedAt || Date.now();
  const dueAt = job.dueAt || completedAt + YEAR;
  const dateLabel = fmtLong(completedAt);
  const goodThrough = fmtLong(dueAt);

  const statusKey = t.failed > 0 || res.overall === "fail" ? "fail" : "pass";
  const SM = {
    pass: { label: "Passed", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
    fail: { label: "Action Required", ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd" },
  } as const;
  const m = SM[statusKey];

  const venueName = job.customer || "the venue";
  const single = rws.length <= 1;
  const primaryPlace = (rws[0] && rws[0].place) || "";
  const locationLabel = single
    ? primaryPlace || job.venue || "—"
    : primaryPlace + " · " + rws.length + " venues";

  const contact = job.contact || {};
  const greetingName = contact.name || "Sir or Madam";

  const owner = job.owner || "Jeff Chesebro";
  const u = org.users.find((x) => x.name === owner) || null;
  const roles = (u && u.roles) || [];
  const signerTitle = roles.filter((r) => r !== "Admin")[0] || roles[0] || "Estimator";
  const signerEmail = (u && u.email) || "";
  const office = org.offices[0] || {};
  const signerPhone = office.phone || "";
  const officeCity = office.city || "";

  const techName = res.performedBy || job.assignedTo || owner;
  const cert = (res.cert || "").trim();
  const notes = (res.notes || "").trim();
  const testedLabel = t.tested + " curtain" + (t.tested === 1 ? "" : "s");
  const resultsPara = narrative(t, goodThrough);

  /* editable report prose (flame_report template, override-or-default) */
  const ov = org.templates;
  const letterIntro = renderField(ov, "flame_report", "letterIntro", {
    company: org.companyName,
    venue: venueName,
    testedLabel,
  });
  const nfpaQuote = renderField(ov, "flame_report", "nfpaQuote", {});
  const closing = renderField(ov, "flame_report", "closing", {});
  const certificateParagraph = renderField(ov, "flame_report", "certificateParagraph", {
    company: org.companyName,
    venue: venueName,
    testedLabel,
    goodThrough,
  });
  const aboutPassed = renderField(ov, "flame_report", "aboutPassed", {});
  const aboutIFR = renderField(ov, "flame_report", "aboutIFR", {});
  const aboutFailed = renderField(ov, "flame_report", "aboutFailed", {});
  const aboutBrief = renderField(ov, "flame_report", "aboutBrief", {})
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const venueRows = rws.map((r) => ({
    label: r.label,
    tested: String(r.tested),
    passed: String(r.passed),
    retreated: r.retreated ? String(r.retreated) : "–",
    failed: String(r.failed),
    failColor: r.failed > 0 ? "#b4543a" : "#c4c9d2",
    retColor: r.retreated > 0 ? "#40454e" : "#c4c9d2",
  }));

  const parts = [t.passed + " passed"];
  if (t.retreated) parts.push(t.retreated + " IFR");
  if (t.failed) parts.push(t.failed + " failed");
  const curtainsValue =
    parts.length > 1 ? t.tested + " · " + parts.join(", ") : String(t.tested);
  const metaRows = [
    { label: "Prepared for", value: venueName },
    { label: "Attn", value: greetingName },
    { label: "Location", value: locationLabel },
    { label: "Date performed", value: dateLabel },
    { label: "Technician", value: techName },
    { label: "Certificate #", value: cert || "—" },
    { label: "Curtains tested", value: curtainsValue },
    { label: "Good through", value: goodThrough },
  ];

  return {
    accent: org.accent,
    companyName: org.companyName,
    letterheadSrc: org.letterhead || letterhead.src,
    letterheadIsLogo: !!org.letterhead,
    dateLabel,
    venueName,
    locationLabel,
    greetingName,
    testedLabel,
    resultsPara,
    letterIntro,
    nfpaQuote,
    closing,
    certificateParagraph,
    aboutPassed,
    aboutIFR,
    aboutFailed,
    aboutBrief,
    hasCert: !!cert,
    cert,
    techName,
    signerName: owner,
    signerTitle,
    signerEmail,
    signerPhone,
    hasPhone: !!signerPhone,
    statusLabel: m.label,
    statusInk: m.ink,
    statusSoft: m.soft,
    statusBd: m.bd,
    venueRows,
    showVenueRows: rws.length > 1,
    totalTested: String(t.tested),
    totalPassed: String(t.passed),
    totalRetreated: t.retreated ? String(t.retreated) : "–",
    totalFailed: String(t.failed),
    totalFailColor: t.failed > 0 ? "#b4543a" : "#c4c9d2",
    metaRows,
    goodThrough,
    officeCity,
    notes,
    hasNotes: !!notes,
  };
}

/* ---------------------------------------------------------------- */

const VENUE_GRID = "minmax(0,1fr) 56px 56px 68px 52px";

function Letterhead({
  accent,
  tag,
  src,
  isLogo,
  alt,
}: {
  accent: string;
  tag: boolean;
  src: string;
  isLogo: boolean;
  alt: string;
}) {
  return (
    <div style={{ marginBottom: tag ? 24 : 20 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        style={
          isLogo
            ? { display: "block", maxHeight: 76, maxWidth: "100%", objectFit: "contain" }
            : { display: "block", width: "100%", height: "auto" }
        }
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
          Field Flame Inspection Results
        </span>
        <span
          style={{
            fontSize: "8.5pt",
            color: "#aab0bb",
            letterSpacing: ".06em",
            textTransform: "uppercase",
          }}
        >
          · NFPA 705
        </span>
      </div>
    </div>
  );
}

function VenueTable({ m, total }: { m: ReportModel; total: boolean }) {
  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: VENUE_GRID,
          gap: 8,
          padding: "0 0 6px",
          borderBottom: "1px solid #e4e7ec",
          fontSize: "8pt",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".04em",
          color: "#aab0bb",
        }}
      >
        <span>Venue</span>
        <span style={{ textAlign: "center" }}>Tested</span>
        <span style={{ textAlign: "center" }}>Passed</span>
        <span style={{ textAlign: "center" }}>IFR</span>
        <span style={{ textAlign: "right" }}>Failed</span>
      </div>
      {m.venueRows.map((v, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: VENUE_GRID,
            gap: 8,
            alignItems: "center",
            padding: "7px 0",
            borderBottom: "1px solid #f4f5f7",
            fontSize: "10pt",
          }}
        >
          <span
            style={{
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {v.label}
          </span>
          <span style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>{v.tested}</span>
          <span style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>{v.passed}</span>
          <span
            style={{ textAlign: "center", fontFamily: "var(--font-mono)", color: v.retColor }}
          >
            {v.retreated}
          </span>
          <span
            style={{
              textAlign: "right",
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              color: v.failColor,
            }}
          >
            {v.failed}
          </span>
        </div>
      ))}
      {total && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: VENUE_GRID,
            gap: 8,
            alignItems: "center",
            padding: "8px 0 0",
            fontSize: "10pt",
            fontWeight: 700,
          }}
        >
          <span>Total</span>
          <span style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>{m.totalTested}</span>
          <span style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>{m.totalPassed}</span>
          <span style={{ textAlign: "center", fontFamily: "var(--font-mono)" }}>
            {m.totalRetreated}
          </span>
          <span
            style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: m.totalFailColor }}
          >
            {m.totalFailed}
          </span>
        </div>
      )}
    </>
  );
}

function MetaGrid({ m, bordered }: { m: ReportModel; bordered: boolean }) {
  return (
    <div
      style={
        bordered
          ? {
              borderTop: "1px solid #e4e7ec",
              borderBottom: "1px solid #e4e7ec",
              padding: "15px 2px",
              marginBottom: 16,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "11px 28px",
            }
          : {
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "9px 24px",
              padding: "14px 16px",
            }
      }
    >
      {m.metaRows.map((mr, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            fontSize: "10pt",
            ...(bordered
              ? {}
              : { borderBottom: "1px solid #f4f5f7", paddingBottom: 7 }),
          }}
        >
          <span style={{ color: "#8c919c" }}>{mr.label}</span>
          <span style={{ fontWeight: 600, textAlign: "right" }}>{mr.value}</span>
        </div>
      ))}
    </div>
  );
}

function Nfpa({ accent, soft, text }: { accent: string; soft: boolean; text: string }) {
  if (soft) {
    return <p style={{ margin: "0 0 14px", fontSize: "9.5pt", color: "#6b7079", lineHeight: 1.5 }}>{text}</p>;
  }
  return (
    <p
      style={{
        margin: "0 0 14px",
        fontSize: "10pt",
        color: "#40454e",
        padding: "10px 14px",
        background: "#f6f7f9",
        borderLeft: `3px solid ${accent}`,
        borderRadius: "0 6px 6px 0",
      }}
    >
      {text}
    </p>
  );
}

function Signer({ m }: { m: ReportModel }) {
  return (
    <div style={{ marginTop: 14, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 600 }}>—{m.signerName}</div>
      <div style={{ color: "#40454e" }}>{m.signerTitle}</div>
      {m.signerEmail && <div style={{ color: "#40454e" }}>{m.signerEmail}</div>}
      {m.hasPhone && <div style={{ color: "#40454e" }}>Office: {m.signerPhone}</div>}
    </div>
  );
}

/** The document sheet — one .pk-doc-page per variant, with shared footer. */
export function ReportBody({ m, variant }: { m: ReportModel; variant: ReportVariant }) {
  const accent = m.accent;
  const chip = (
    <span
      style={{
        display: "inline-block",
        fontSize: "9pt",
        fontWeight: 700,
        letterSpacing: ".05em",
        textTransform: "uppercase",
        color: m.statusInk,
        background: m.statusSoft,
        border: `1px solid ${m.statusBd}`,
        padding: "4px 12px",
        borderRadius: 6,
      }}
    >
      {m.statusLabel}
    </span>
  );

  return (
    <div className="pk-doc-page">
      <div style={{ fontFamily: "var(--font-ui)", color: "#1a1c20" }}>
        {/* ================= LETTER ================= */}
        {variant === "letter" && (
          <div style={{ fontSize: "11.5pt", lineHeight: 1.55 }}>
            <Letterhead accent={accent} tag src={m.letterheadSrc} isLogo={m.letterheadIsLogo} alt={m.companyName} />
            <div style={{ marginBottom: 3 }}><span style={{ color: "#6b7079" }}>Date:</span> {m.dateLabel}</div>
            <div style={{ marginBottom: 3 }}><span style={{ color: "#6b7079" }}>Venue Name:</span> <strong>{m.venueName}</strong></div>
            <div style={{ marginBottom: 18 }}><span style={{ color: "#6b7079" }}>Location:</span> {m.locationLabel}</div>
            <div style={{ marginBottom: 3 }}><span style={{ color: "#6b7079" }}>RE:</span> Field Flame Inspection at {m.venueName}</div>
            <div style={{ marginBottom: 16 }}>Dear {m.greetingName},</div>
            <p style={{ margin: "0 0 13px" }}>{m.letterIntro}</p>
            <Nfpa accent={accent} soft={false} text={m.nfpaQuote} />
            <p style={{ margin: "0 0 13px" }}>{m.resultsPara}</p>
            {m.hasCert && (
              <p style={{ margin: "0 0 13px" }}>
                This field test is recorded under certificate <strong>{m.cert}</strong>, performed{" "}
                {m.dateLabel} by {m.techName}.
              </p>
            )}
            <p style={{ margin: "0 0 16px" }}>{m.closing}</p>
            <p style={{ margin: "0 0 6px" }}>If you have any questions, please contact me directly at:</p>
            <Signer m={m} />
          </div>
        )}

        {/* ================= SUMMARY ================= */}
        {variant === "summary" && (
          <div style={{ fontSize: "11.5pt", lineHeight: 1.55 }}>
            <Letterhead accent={accent} tag={false} src={m.letterheadSrc} isLogo={m.letterheadIsLogo} alt={m.companyName} />
            <div style={{ marginBottom: 3 }}><span style={{ color: "#6b7079" }}>Date:</span> {m.dateLabel}</div>
            <div style={{ marginBottom: 3 }}><span style={{ color: "#6b7079" }}>Venue Name:</span> <strong>{m.venueName}</strong></div>
            <div style={{ marginBottom: 16 }}><span style={{ color: "#6b7079" }}>Location:</span> {m.locationLabel}</div>
            <div style={{ marginBottom: 14 }}>Dear {m.greetingName},</div>
            <p style={{ margin: "0 0 16px" }}>
              Per your request, {m.companyName} performed a field flame-retardant test at{" "}
              {m.venueName} on {m.testedLabel} per NFPA 705 — Recommended Practice for a Field Flame
              Test. The results are summarized below.
            </p>

            <div
              style={{
                border: "1px solid #e4e7ec",
                borderRadius: 11,
                overflow: "hidden",
                margin: "0 0 18px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 16px",
                  background: "#fafbfc",
                  borderBottom: "1px solid #eef0f3",
                }}
              >
                <div
                  style={{
                    fontSize: "9pt",
                    fontWeight: 700,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    color: "#8c919c",
                  }}
                >
                  Field Flame Inspection Summary
                </div>
                {chip}
              </div>
              <MetaGrid m={m} bordered={false} />
              {m.showVenueRows && (
                <div style={{ padding: "2px 16px 14px" }}>
                  <VenueTable m={m} total />
                </div>
              )}
            </div>

            <Nfpa accent={accent} soft={false} text={m.nfpaQuote} />
            <p style={{ margin: "0 0 13px" }}>{m.resultsPara}</p>
            {m.hasNotes && (
              <p style={{ margin: "0 0 13px", fontSize: "10.5pt", color: "#40454e" }}>
                <span style={{ color: "#8c919c" }}>Field notes:</span> {m.notes}
              </p>
            )}
            <p style={{ margin: "0 0 16px" }}>{m.closing}</p>
            <p style={{ margin: "0 0 6px" }}>If you have any questions, please contact me directly at:</p>
            <Signer m={m} />
          </div>
        )}

        {/* ================= CERTIFICATE ================= */}
        {variant === "certificate" && (
          <div>
            <div style={{ borderBottom: "2px solid #16181d", paddingBottom: 14, marginBottom: 22 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={m.letterheadSrc}
                alt={m.companyName}
                style={
                  m.letterheadIsLogo
                    ? { display: "block", maxHeight: 76, maxWidth: "100%", objectFit: "contain" }
                    : { display: "block", width: "100%", height: "auto" }
                }
              />
            </div>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div
                style={{
                  fontSize: "8.5pt",
                  fontWeight: 700,
                  letterSpacing: ".16em",
                  textTransform: "uppercase",
                  color: accent,
                }}
              >
                NFPA 705 · Field Flame Test
              </div>
              <div
                style={{
                  fontSize: "21pt",
                  fontWeight: 800,
                  letterSpacing: "-.01em",
                  marginTop: 7,
                  lineHeight: 1.1,
                }}
              >
                Certificate of Flame Resistance
              </div>
              <div style={{ height: 2, width: 66, background: accent, margin: "14px auto 0" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
              <span
                style={{
                  display: "inline-block",
                  fontSize: "12pt",
                  fontWeight: 800,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: m.statusInk,
                  background: m.statusSoft,
                  border: `2px solid ${m.statusBd}`,
                  padding: "9px 26px",
                  borderRadius: 9,
                }}
              >
                {m.statusLabel}
              </span>
            </div>
            <p
              style={{
                textAlign: "center",
                fontSize: "10.5pt",
                lineHeight: 1.55,
                color: "#40454e",
                maxWidth: "5.6in",
                margin: "0 auto 22px",
              }}
            >
              {m.certificateParagraph}
            </p>

            <MetaGrid m={m} bordered />

            {m.showVenueRows && (
              <div style={{ marginBottom: 16 }}>
                <VenueTable m={m} total={false} />
              </div>
            )}

            <Nfpa accent={accent} soft text={m.nfpaQuote} />
            {m.hasNotes && (
              <p style={{ margin: "0 0 14px", fontSize: "10pt", color: "#40454e" }}>
                <span style={{ color: "#8c919c" }}>Field notes:</span> {m.notes}
              </p>
            )}

            {/* about-this-test explainer */}
            <div
              style={{
                breakInside: "avoid",
                border: "1px solid #e4e7ec",
                borderRadius: 10,
                padding: "14px 16px",
                background: "#fafbfc",
                margin: "6px 0 4px",
              }}
            >
              <div
                style={{
                  fontSize: "8.5pt",
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: accent,
                  marginBottom: 9,
                }}
              >
                About this test — result terms &amp; NFPA 705
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: "9.5pt", fontWeight: 700, marginBottom: 2 }}>Passed</div>
                  <div style={{ fontSize: "8.5pt", color: "#40454e", lineHeight: 1.45 }}>
                    {m.aboutPassed}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "9.5pt", fontWeight: 700, marginBottom: 2 }}>
                    IFR — Inherently Flame Retardant
                  </div>
                  <div style={{ fontSize: "8.5pt", color: "#40454e", lineHeight: 1.45 }}>
                    {m.aboutIFR}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "9.5pt", fontWeight: 700, marginBottom: 2 }}>Failed</div>
                  <div style={{ fontSize: "8.5pt", color: "#40454e", lineHeight: 1.45 }}>
                    {m.aboutFailed}
                  </div>
                </div>
              </div>
              <div style={{ borderTop: "1px solid #eef0f3", paddingTop: 11 }}>
                <div style={{ fontSize: "9.5pt", fontWeight: 700, marginBottom: 7 }}>
                  NFPA 705 — field flame test, in brief
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "6px 20px",
                    fontSize: "8.5pt",
                    color: "#40454e",
                    lineHeight: 1.45,
                  }}
                >
                  {m.aboutBrief.map((li, i) => (
                    <div key={i} style={{ display: "flex", gap: 7 }}>
                      <span style={{ color: accent, flexShrink: 0 }}>•</span>
                      <span>{li}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 22,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end",
                gap: 24,
              }}
            >
              <div style={{ fontSize: "9pt", color: "#8c919c", lineHeight: 1.55, maxWidth: "58%" }}>
                Enclosed: an invoice for these services and a sample flame tag for your records.
                Certified flame-resistant for one year — good through {m.goodThrough}.
              </div>
              <div style={{ textAlign: "right", minWidth: 210 }}>
                <div style={{ borderTop: "1px solid #16181d", paddingTop: 6, fontWeight: 600, fontSize: "11pt" }}>
                  {m.signerName}
                </div>
                <div style={{ fontSize: "9pt", color: "#6b7079" }}>
                  {m.signerTitle} · {m.companyName}
                </div>
                {m.hasPhone && (
                  <div style={{ fontSize: "9pt", color: "#6b7079" }}>Office: {m.signerPhone}</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* shared running footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: "var(--font-ui)",
            fontSize: "8pt",
            color: "#aab0bb",
            borderTop: "1px solid #eef0f3",
            paddingTop: 6,
            marginTop: 26,
          }}
        >
          <span>
            {m.companyName}
            {m.officeCity ? " · " + m.officeCity : ""}
          </span>
          <span>NFPA 705 · Field Flame Test</span>
        </div>
      </div>
    </div>
  );
}

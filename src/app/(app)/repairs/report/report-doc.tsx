import { fmtLong, categoryMeta, priorityMeta } from "@/lib/stores/repair-jobs";
import letterhead from "./peak-letterhead.jpg";

/**
 * Repair Service Report document body — three printable variants (letter /
 * summary / report) on the .pk-doc-page foundation, the repair twin of the
 * flame-test report-doc. Shared by the live report (report/page.tsx) and the
 * three-up comparison (report/options/page.tsx).
 *
 * buildReportModel() resolves a completed repair job (+ its completion
 * subdoc) into display values; ReportBody renders the active variant.
 */

export type ReportVariant = "letter" | "summary" | "report";

/* ---- loose job shape (accepts a real RepairJobRecord or the options sample) ---- */
type JobVenue = {
  id?: string | null;
  label?: string;
  city?: string;
  state?: string;
};
type JobItem = { label?: string; qty?: number; note?: string };
type JobPart = { name?: string; qty?: number; cost?: number };
export type ReportJob = {
  id?: string;
  customer?: string;
  venue?: string;
  owner?: string;
  assignedTo?: string;
  completedAt?: number | null;
  stage?: string;
  category?: string;
  priority?: string;
  title?: string;
  scope?: string;
  items?: JobItem[];
  parts?: JobPart[];
  laborHours?: number;
  crew?: string[];
  warrantyMonths?: number;
  contact?: { name?: string } | null;
  venues?: JobVenue[];
  source?: { kind?: string; refId?: string; label?: string } | null;
  completion?: {
    performedBy?: string;
    workPerformed?: string;
    partsUsed?: string[];
    followUp?: string;
  } | null;
};

export type OrgCtx = {
  accent: string;
  companyName: string;
  offices: Array<{ city?: string; phone?: string }>;
  users: Array<{ name: string; roles: string[] | null; email: string }>;
};

const DAY = 86400000;
const MONTH = 30 * DAY;

export type ReportModel = ReturnType<typeof buildReportModel>;

export function buildReportModel(job: ReportJob, org: OrgCtx) {
  const completion = job.completion || {};
  const cat = categoryMeta(job.category);
  const pm = priorityMeta(job.priority);

  const completedAt = job.completedAt || Date.now();
  const dateLabel = fmtLong(completedAt);
  const warrantyMonths = job.warrantyMonths != null ? job.warrantyMonths : 12;
  const warrantyThrough = fmtLong(completedAt + warrantyMonths * MONTH);

  const followUp = (completion.followUp || "").trim();
  const statusKey = followUp ? "followup" : "done";
  const SM = {
    done: { label: "Work Completed", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
    followup: { label: "Follow-up Recommended", ink: "#9a6a1f", soft: "#fbf3dd", bd: "#f0e2bd" },
  } as const;
  const m = SM[statusKey];

  const venueName = job.customer || "the venue";
  const venues = job.venues || [];
  const primaryPlace = venues[0]
    ? [venues[0].city, venues[0].state].filter(Boolean).join(", ")
    : "";
  const locationLabel =
    venues.length > 1
      ? primaryPlace + " · " + venues.length + " venues"
      : primaryPlace || job.venue || "—";

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

  const techName = completion.performedBy || job.assignedTo || owner;
  const crew = (job.crew || []).filter((c) => c && c !== techName);
  const crewLabel = crew.length ? techName + " + " + crew.join(", ") : techName;

  const workPerformed = (completion.workPerformed || job.scope || "").trim();
  const scopeItems = (job.items || [])
    .map((i) => ({
      label: (i.label || "").trim(),
      qty: i.qty || 1,
      note: (i.note || "").trim(),
    }))
    .filter((i) => i.label);
  const partsUsed =
    completion.partsUsed && completion.partsUsed.length
      ? completion.partsUsed.filter((p) => (p || "").trim())
      : (job.parts || [])
          .filter((p) => (p.name || "").trim())
          .map((p) => (p.qty ? p.qty + "× " : "") + p.name);

  const laborHours = job.laborHours || 0;
  const fromInspection =
    job.source && job.source.kind === "inspection" && job.source.refId
      ? job.source.refId
      : "";

  const metaRows = [
    { label: "Prepared for", value: venueName },
    { label: "Attn", value: greetingName },
    { label: "Location", value: locationLabel },
    { label: "Date completed", value: dateLabel },
    { label: "Technician", value: crewLabel },
    { label: "Category", value: cat.label },
    { label: "Priority", value: pm.long },
    { label: "Warranty through", value: warrantyThrough },
  ];

  return {
    accent: org.accent,
    companyName: org.companyName,
    jobId: job.id || "",
    dateLabel,
    venueName,
    locationLabel,
    greetingName,
    categoryLabel: cat.label,
    categoryShort: cat.short,
    priorityLong: pm.long,
    title: job.title || "Repair",
    workPerformed,
    hasWork: !!workPerformed,
    scopeItems,
    partsUsed,
    laborHours,
    followUp,
    hasFollowUp: !!followUp,
    fromInspection,
    warrantyMonths,
    warrantyThrough,
    techName,
    crewLabel,
    signerName: owner,
    signerTitle,
    signerEmail,
    signerPhone,
    hasPhone: !!signerPhone,
    statusLabel: m.label,
    statusInk: m.ink,
    statusSoft: m.soft,
    statusBd: m.bd,
    metaRows,
    officeCity,
  };
}

/* ---------------------------------------------------------------- */

function Letterhead({ accent, tag }: { accent: string; tag: boolean }) {
  return (
    <div style={{ marginBottom: tag ? 24 : 20 }}>
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
          Repair Service Report
        </span>
        <span
          style={{
            fontSize: "8.5pt",
            color: "#aab0bb",
            letterSpacing: ".06em",
            textTransform: "uppercase",
          }}
        >
          · Completed Work
        </span>
      </div>
    </div>
  );
}

function ScopeList({ m }: { m: ReportModel }) {
  return (
    <>
      <div
        style={{
          padding: "0 0 6px",
          borderBottom: "1px solid #e4e7ec",
          fontSize: "8pt",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".04em",
          color: "#aab0bb",
        }}
      >
        Scope of work
      </div>
      {m.scopeItems.map((it, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            alignItems: "baseline",
            padding: "7px 0",
            borderBottom: "1px solid #f4f5f7",
            fontSize: "10pt",
          }}
        >
          <span style={{ fontWeight: 600 }}>
            {it.label}
            {it.note ? (
              <span style={{ fontWeight: 400, color: "#6b7079" }}> — {it.note}</span>
            ) : null}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", color: "#6b7079", flexShrink: 0 }}>
            ×{it.qty}
          </span>
        </div>
      ))}
    </>
  );
}

function PartsList({ m }: { m: ReportModel }) {
  return (
    <>
      <div
        style={{
          padding: "0 0 6px",
          borderBottom: "1px solid #e4e7ec",
          fontSize: "8pt",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".04em",
          color: "#aab0bb",
        }}
      >
        Parts &amp; materials used
      </div>
      {m.partsUsed.map((p, i) => (
        <div
          key={i}
          style={{
            padding: "7px 0",
            borderBottom: "1px solid #f4f5f7",
            fontSize: "10pt",
          }}
        >
          {p}
        </div>
      ))}
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

function FollowUp({ m, accent }: { m: ReportModel; accent: string }) {
  if (!m.hasFollowUp) return null;
  return (
    <p
      style={{
        margin: "0 0 14px",
        fontSize: "10pt",
        color: "#40454e",
        padding: "10px 14px",
        background: "#fbf3dd",
        borderLeft: `3px solid ${accent}`,
        borderRadius: "0 6px 6px 0",
      }}
    >
      <strong style={{ color: "#8a6d1f" }}>Recommended follow-up:</strong> {m.followUp}
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

  const introSentence =
    "Per your approval, " +
    m.companyName +
    " completed the " +
    m.categoryLabel.toLowerCase() +
    " repair at " +
    m.venueName +
    " on " +
    m.dateLabel +
    (m.fromInspection
      ? ", addressing the findings identified during rigging inspection " +
        m.fromInspection
      : "") +
    ". The work performed is summarized below:";

  return (
    <div className="pk-doc-page">
      <div style={{ fontFamily: "var(--font-ui)", color: "#1a1c20" }}>
        {/* ================= LETTER ================= */}
        {variant === "letter" && (
          <div style={{ fontSize: "11.5pt", lineHeight: 1.55 }}>
            <Letterhead accent={accent} tag />
            <div style={{ marginBottom: 3 }}><span style={{ color: "#6b7079" }}>Date:</span> {m.dateLabel}</div>
            <div style={{ marginBottom: 3 }}><span style={{ color: "#6b7079" }}>Venue Name:</span> <strong>{m.venueName}</strong></div>
            <div style={{ marginBottom: 18 }}><span style={{ color: "#6b7079" }}>Location:</span> {m.locationLabel}</div>
            <div style={{ marginBottom: 3 }}><span style={{ color: "#6b7079" }}>RE:</span> {m.categoryLabel} repair at {m.venueName}</div>
            <div style={{ marginBottom: 16 }}>Dear {m.greetingName},</div>
            <p style={{ margin: "0 0 13px" }}>{introSentence}</p>
            {m.hasWork && <p style={{ margin: "0 0 13px", whiteSpace: "pre-wrap" }}>{m.workPerformed}</p>}
            {m.partsUsed.length > 0 && (
              <p style={{ margin: "0 0 13px" }}>
                Parts and materials used: {m.partsUsed.join("; ")}.
              </p>
            )}
            <FollowUp m={m} accent={accent} />
            <p style={{ margin: "0 0 13px" }}>
              All workmanship on this repair is covered by our {m.warrantyMonths}-month warranty —
              good through <strong>{m.warrantyThrough}</strong>. If anything covered by this work
              needs attention before then, contact us and we will make it right.
            </p>
            <p style={{ margin: "0 0 16px" }}>
              Enclosed you will find an invoice for these services.
            </p>
            <p style={{ margin: "0 0 6px" }}>If you have any questions, please contact me directly at:</p>
            <Signer m={m} />
          </div>
        )}

        {/* ================= SUMMARY ================= */}
        {variant === "summary" && (
          <div style={{ fontSize: "11.5pt", lineHeight: 1.55 }}>
            <Letterhead accent={accent} tag={false} />
            <div style={{ marginBottom: 3 }}><span style={{ color: "#6b7079" }}>Date:</span> {m.dateLabel}</div>
            <div style={{ marginBottom: 3 }}><span style={{ color: "#6b7079" }}>Venue Name:</span> <strong>{m.venueName}</strong></div>
            <div style={{ marginBottom: 16 }}><span style={{ color: "#6b7079" }}>Location:</span> {m.locationLabel}</div>
            <div style={{ marginBottom: 14 }}>Dear {m.greetingName},</div>
            <p style={{ margin: "0 0 16px" }}>{introSentence}</p>

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
                  Service Summary
                </div>
                {chip}
              </div>
              <MetaGrid m={m} bordered={false} />
              {m.scopeItems.length > 0 && (
                <div style={{ padding: "2px 16px 14px" }}>
                  <ScopeList m={m} />
                </div>
              )}
            </div>

            {m.hasWork && <p style={{ margin: "0 0 13px", whiteSpace: "pre-wrap" }}>{m.workPerformed}</p>}
            {m.partsUsed.length > 0 && (
              <p style={{ margin: "0 0 13px", fontSize: "10.5pt", color: "#40454e" }}>
                <span style={{ color: "#8c919c" }}>Parts used:</span> {m.partsUsed.join("; ")}
              </p>
            )}
            <FollowUp m={m} accent={accent} />
            <p style={{ margin: "0 0 16px" }}>
              All workmanship is covered by our {m.warrantyMonths}-month warranty — good through{" "}
              {m.warrantyThrough}. Enclosed you will find an invoice for these services.
            </p>
            <p style={{ margin: "0 0 6px" }}>If you have any questions, please contact me directly at:</p>
            <Signer m={m} />
          </div>
        )}

        {/* ================= SERVICE REPORT ================= */}
        {variant === "report" && (
          <div>
            <div style={{ borderBottom: "2px solid #16181d", paddingBottom: 14, marginBottom: 22 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={letterhead.src}
                alt="Peak Systems Group, Inc."
                style={{ display: "block", width: "100%", height: "auto" }}
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
                {m.categoryLabel} · {m.priorityLong}
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
                Repair Service Report
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
              This report records that {m.companyName} completed the{" "}
              {m.categoryLabel.toLowerCase()} repair at{" "}
              <strong style={{ color: "#1a1c20" }}>{m.venueName}</strong> ({m.locationLabel}) on{" "}
              {m.dateLabel}
              {m.fromInspection ? ", from rigging inspection " + m.fromInspection : ""}.
            </p>

            <MetaGrid m={m} bordered />

            {m.scopeItems.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <ScopeList m={m} />
              </div>
            )}

            {m.hasWork && (
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    padding: "0 0 6px",
                    borderBottom: "1px solid #e4e7ec",
                    fontSize: "8pt",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: ".04em",
                    color: "#aab0bb",
                  }}
                >
                  Work performed
                </div>
                <p style={{ margin: "8px 0 0", fontSize: "10pt", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                  {m.workPerformed}
                </p>
              </div>
            )}

            {m.partsUsed.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <PartsList m={m} />
              </div>
            )}

            <FollowUp m={m} accent={accent} />

            {/* warranty explainer */}
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
                About this repair — workmanship warranty
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                <div>
                  <div style={{ fontSize: "9.5pt", fontWeight: 700, marginBottom: 2 }}>Coverage</div>
                  <div style={{ fontSize: "8.5pt", color: "#40454e", lineHeight: 1.45 }}>
                    The workmanship on this repair is warranted for {m.warrantyMonths} months from
                    the completion date — good through {m.warrantyThrough}.
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "9.5pt", fontWeight: 700, marginBottom: 2 }}>
                    If something recurs
                  </div>
                  <div style={{ fontSize: "8.5pt", color: "#40454e", lineHeight: 1.45 }}>
                    Contact our office and reference this report ({m.jobId || "job id"}). Covered
                    issues are corrected at no charge; we track every completed repair for
                    follow-up.
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "9.5pt", fontWeight: 700, marginBottom: 2 }}>
                    What isn&#39;t covered
                  </div>
                  <div style={{ fontSize: "8.5pt", color: "#40454e", lineHeight: 1.45 }}>
                    Normal wear, misuse, and components outside the repaired scope. Separate
                    manufacturer warranties apply to supplied parts.
                  </div>
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
                Enclosed: an invoice for these services. Performed by {m.crewLabel}
                {m.laborHours ? " · " + m.laborHours + " crew-hours on site" : ""}.
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
          <span>
            Repair Service Report{m.jobId ? " · " + m.jobId : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

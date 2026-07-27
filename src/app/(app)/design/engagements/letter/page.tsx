import Link from "next/link";
import { requireUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";
import {
  getEngagement,
  getEngagementByQuote,
  type ConsultingEngagement,
  type ConsultingQuotePayload,
} from "@/lib/stores/engagements";
import { getAllDesigns, type DesignRecord } from "@/lib/stores/designs";
import { getSettings } from "@/lib/settings";
import { renderField } from "@/lib/templates";
import { scopesTotal } from "@/lib/consulting-stages";
import { PrintButton } from "./controls";

export const metadata = { title: "Consulting document — Quartzite-6" };

/**
 * Consulting document generators (D90, spec §Document generation):
 *   /design/engagements/letter?id=<quoteId>&kind=proposal — proposal + professional-
 *     services agreement, filled from the consulting quote (+ engagement).
 *   /design/engagements/letter?id=<engagementId>&kind=spec — spec-package boilerplate
 *     filled from the engagement + linked Design Studio designs.
 * Wording is editable in /templates (consulting_proposal / consulting_spec)
 * like every other letter. Printable on the .pk-doc-page foundation.
 */

function money(n: number | null | undefined): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}
function longDate(ms?: number | null): string {
  return new Date(ms || Date.now()).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const TOOLBAR_CSS = `
  .cl-toolbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 18px; background: rgba(247,248,250,.92); backdrop-filter: blur(8px); border-bottom: 1px solid #e4e7ec; }
  @media print { .cl-toolbar { display: none; } }
`;

const SANS =
  'var(--font-ui, "Public Sans"), system-ui, -apple-system, "Segoe UI", sans-serif';

const H2: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".09em",
  textTransform: "uppercase",
  margin: "26px 0 8px",
};

const BODY: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 12.5,
  lineHeight: 1.65,
  margin: "0 0 10px",
  whiteSpace: "pre-wrap",
};

export default async function ConsultingLetterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, settings] = await Promise.all([
    requireUser(),
    searchParams,
    getSettings(),
  ]);
  const accent = settings.accent || "#b08d4a";
  const companyName = settings.companyName || "Peak Systems Group";
  const id = one(sp.id);
  const kind = one(sp.kind) === "spec" ? "spec" : "proposal";
  const t = settings.templates;

  /* resolve the records for either entry path */
  let eng: ConsultingEngagement | null = null;
  let quoteId = "";
  if (kind === "spec") {
    eng = await getEngagement(id);
    quoteId = eng?.quoteId || "";
  } else {
    quoteId = id;
    eng = await getEngagementByQuote(id);
  }
  const quote = quoteId ? await getQuote(quoteId) : null;
  const ok =
    kind === "spec" ? !!eng : !!(quote && quote.quoteType === "consulting");

  if (!ok) {
    return (
      <div style={{ padding: 40, fontFamily: SANS }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Document not found</div>
        <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 6 }}>
          {kind === "spec"
            ? "That engagement id doesn't resolve."
            : "That id isn't a saved consulting quote."}
        </div>
        <Link href="/design/engagements" style={{ color: accent, fontSize: 12.5 }}>
          ← Consulting
        </Link>
      </div>
    );
  }

  const pay = ((quote?.consulting || null) as ConsultingQuotePayload | null) || {
    scope: "",
    feeMode: "fixed" as const,
    fees: [],
    terms: "",
    phases: [],
  };
  const customer = quote?.customer || eng?.customer || "";
  const engagementName = quote?.name || eng?.name || "Consulting engagement";
  const contact =
    quote?.contact && typeof quote.contact === "object"
      ? (quote.contact as { name?: string; role?: string; email?: string })
      : null;
  const scopes = pay.scopes || [];
  const assumptions = pay.assumptions || [];
  const total = scopes.length
    ? scopesTotal(scopes)
    : pay.feeMode === "milestones"
      ? pay.fees.reduce((a, f) => a + (f.amount || 0), 0)
      : pay.fees[0]?.amount || quote?.value || 0;

  const vars = {
    company: companyName,
    customer,
    contactName: contact?.name || "",
    engagement: engagementName,
    fee: money(total),
    date: longDate(),
  };

  const linkedDesigns: DesignRecord[] =
    kind === "spec" && eng && eng.designIds.length
      ? (await getAllDesigns()).filter((d) => eng!.designIds.includes(d.id))
      : [];

  const backHref =
    kind === "spec"
      ? `/design/engagements/${encodeURIComponent(eng!.id)}`
      : `/design/engagements/quote?id=${encodeURIComponent(quoteId)}`;

  return (
    <div style={{ minHeight: "100%", background: "#f1f2f5" }}>
      <style>{TOOLBAR_CSS}</style>
      <div className="cl-toolbar">
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <Link href={backHref} style={{ fontFamily: SANS, fontSize: 12.5, color: "#5b616e", textDecoration: "none" }}>
            ← Back
          </Link>
          <span style={{ fontFamily: SANS, fontSize: 12.5, color: "#9aa0ab" }}>
            Wording editable in{" "}
            <Link href="/templates" style={{ color: accent }}>
              Templates
            </Link>
          </span>
        </div>
        <PrintButton accent={accent} />
      </div>

      <div className="pk-doc-page" style={{ maxWidth: 760, margin: "26px auto 60px", background: "#fff", padding: "48px 56px", boxShadow: "0 2px 14px rgba(16,22,30,.09)" }}>
        {/* header band */}
        <div style={{ borderBottom: `3px solid ${accent}`, paddingBottom: 14, marginBottom: 22 }}>
          <div style={{ fontFamily: SANS, fontSize: 17, fontWeight: 800, letterSpacing: "-.01em" }}>{companyName}</div>
          <div style={{ fontFamily: SANS, fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: accent, marginTop: 6 }}>
            {kind === "spec" ? "Specification Package" : "Consulting Proposal & Professional Services Agreement"}
          </div>
          <div style={{ fontFamily: SANS, fontSize: 11.5, color: "#5b616e", marginTop: 8, display: "flex", gap: 18, flexWrap: "wrap" }}>
            <span><b>{kind === "spec" ? "Engagement" : "Quote"}:</b> {kind === "spec" ? eng!.id : quoteId}</span>
            <span><b>Customer:</b> {customer}</span>
            <span><b>Date:</b> {vars.date}</span>
          </div>
        </div>

        {kind === "proposal" ? (
          <>
            <p style={BODY}>{renderField(t, "consulting_proposal", "intro", vars)}</p>

            <div style={{ ...H2, color: accent }}>Scope of services</div>
            <p style={BODY}>{renderField(t, "consulting_proposal", "scopeLead", vars)}</p>
            {scopes.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: SANS, fontSize: 12.5, margin: "4px 0 12px" }}>
                <tbody>
                  {scopes.map((s) => (
                    <tr key={s.id} style={{ borderBottom: "1px solid #eef0f3", verticalAlign: "top" }}>
                      <td style={{ padding: "7px 4px" }}>
                        <b>{s.title || "Scope"}</b>
                        {s.description && (
                          <div style={{ color: "#5b616e", marginTop: 2, whiteSpace: "pre-wrap" }}>{s.description}</div>
                        )}
                      </td>
                      <td style={{ padding: "7px 4px", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {money(s.fee)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ padding: "9px 4px", fontWeight: 700 }}>Total professional fee</td>
                    <td style={{ padding: "9px 4px", textAlign: "right", fontWeight: 700 }}>{money(total)}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p style={{ ...BODY, background: "#f9fafb", border: "1px solid #eef0f3", borderRadius: 8, padding: "12px 14px" }}>
                {pay.scope || "Scope to be defined."}
              </p>
            )}
            {pay.phases.length > 0 && (
              <p style={{ ...BODY, color: "#5b616e" }}>
                Anticipated phases: {pay.phases.join(" · ")}. Progress gates on internal review by {companyName}.
              </p>
            )}

            {scopes.length ? null : (
              <>
                <div style={{ ...H2, color: accent }}>Professional fee</div>
                {pay.feeMode === "milestones" && pay.fees.length > 0 ? (
                  <>
                    <p style={BODY}>{renderField(t, "consulting_proposal", "feeLineMilestones", vars)}</p>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: SANS, fontSize: 12.5, margin: "4px 0 12px" }}>
                      <tbody>
                        {pay.fees.map((f, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #eef0f3" }}>
                            <td style={{ padding: "7px 4px" }}>{f.name || `Milestone ${i + 1}`}</td>
                            <td style={{ padding: "7px 4px", textAlign: "right", fontWeight: 600 }}>{money(f.amount)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td style={{ padding: "9px 4px", fontWeight: 700 }}>Total</td>
                          <td style={{ padding: "9px 4px", textAlign: "right", fontWeight: 700 }}>{money(total)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </>
                ) : (
                  <p style={BODY}>{renderField(t, "consulting_proposal", "feeLineFixed", vars)}</p>
                )}
                <p style={{ ...BODY, fontSize: 11.5, color: "#5b616e" }}>
                  {renderField(t, "consulting_proposal", "taxNote", vars)}
                </p>
              </>
            )}

            <div style={{ ...H2, color: accent }}>Terms</div>
            <p style={BODY}>{renderField(t, "consulting_proposal", "termsBlock", vars)}</p>
            {pay.terms && <p style={BODY}>{pay.terms}</p>}

            {assumptions.length > 0 && (
              <>
                <div style={{ ...H2, color: accent }}>Assumptions</div>
                <p style={BODY}>{renderField(t, "consulting_proposal", "assumptionsLead", vars)}</p>
                <ul style={{ fontFamily: SANS, fontSize: 12.5, lineHeight: 1.65, margin: "0 0 10px", paddingLeft: 22 }}>
                  {assumptions.map((a, i) => (
                    <li key={i} style={{ marginBottom: 3 }}>{a}</li>
                  ))}
                </ul>
              </>
            )}

            <div style={{ ...H2, color: accent }}>Acceptance</div>
            <p style={BODY}>{renderField(t, "consulting_proposal", "signoff", vars)}</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, marginTop: 34, fontFamily: SANS, fontSize: 11.5 }}>
              {[customer || "Customer", companyName].map((party) => (
                <div key={party}>
                  <div style={{ borderBottom: "1.5px solid #16181d", height: 34 }} />
                  <div style={{ marginTop: 6, color: "#5b616e" }}>{party} — signature / date</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <p style={BODY}>{renderField(t, "consulting_spec", "coverIntro", vars)}</p>

            <div style={{ ...H2, color: accent }}>General conditions</div>
            <p style={BODY}>{renderField(t, "consulting_spec", "generalConditions", vars)}</p>

            {pay.scope && (
              <>
                <div style={{ ...H2, color: accent }}>Project scope</div>
                <p style={BODY}>{pay.scope}</p>
              </>
            )}

            <div style={{ ...H2, color: accent }}>Equipment schedule</div>
            <p style={BODY}>{renderField(t, "consulting_spec", "scheduleLead", vars)}</p>
            {linkedDesigns.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: SANS, fontSize: 12.5, margin: "4px 0 12px" }}>
                <thead>
                  <tr style={{ borderBottom: "1.5px solid #16181d", textAlign: "left" }}>
                    <th style={{ padding: "6px 4px" }}>Design</th>
                    <th style={{ padding: "6px 4px" }}>Stage / systems</th>
                    <th style={{ padding: "6px 4px", textAlign: "right" }}>Budgetary value</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedDesigns.map((d) => (
                    <tr key={d.id} style={{ borderBottom: "1px solid #eef0f3" }}>
                      <td style={{ padding: "7px 4px" }}>
                        {d.id} — {d.name}
                        {d.venue ? ` (${d.venue})` : ""}
                      </td>
                      <td style={{ padding: "7px 4px", color: "#5b616e" }}>
                        {d.width && d.depth ? `${d.width}′ × ${d.depth}′${d.grid ? ` · ${d.grid}′ grid` : ""} · ` : ""}
                        {(d.systems || []).join(", ") || "—"}
                      </td>
                      <td style={{ padding: "7px 4px", textAlign: "right" }}>{money(d.budget)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ ...BODY, color: "#8c919c" }}>
                No designs are linked to this engagement yet.
              </p>
            )}

            <div style={{ ...H2, color: accent }}>Clarifications</div>
            <p style={BODY}>{renderField(t, "consulting_spec", "closing", vars)}</p>
          </>
        )}
      </div>
    </div>
  );
}

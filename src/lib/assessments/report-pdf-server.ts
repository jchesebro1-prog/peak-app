/* Assessments engine (#337, Task 10) — one headless-Chrome render of an assessment report or a findings-only report,
   through the signed /print/assessment/[id] and /print/assessment-findings/[scope] routes. Shared by the staff PDF
   routes and the Email report action (which attaches the same render) — neither calls the other over HTTP. Mirrors
   src/lib/estimate-output/cover-pdf-server.ts. Server-only. */
import { printOriginFor } from "@/lib/quote-pdf/origin";
import { PdfRenderUnavailable, renderPrintRouteToPdf } from "@/lib/quote-pdf/render";
import { signPrintToken } from "@/lib/quote-pdf/token";
import { getAssessment } from "@/lib/stores/assessments";
import { getSite } from "@/lib/identity/sites";
import { getCompany } from "@/lib/identity/companies";
import { siteDisplayName } from "./report-data";
import { REPORT_WAIT_FOR, assessmentPdfName, findingsPdfName } from "./report-model";
import { parseFindingsScope } from "./register";

/** Per render step. The assessment report adds a `waitFor` step (photos decoding): launch 20 + goto 25 + fonts 10 +
 *  waitFor 25 + pdf 25 = 105 s, inside the routes' 120 s maxDuration. */
export const REPORT_RENDER_STEP_MS = 25_000;
/** Bounds the queue wait too. */
export const REPORT_RENDER_DEADLINE_MS = 115_000;

export const REPORT_RENDER_FAILED = "The report PDF couldn’t be rendered — try again.";
export const REPORT_NO_SECRET = "Report PDFs aren’t set up on this server (AUTH_SECRET is missing).";

/** `status` mirrors the route's answer: 404 unknown, 503 not set up here (secret, origin, Chrome), 500 the render failed. */
export type ReportRender = { ok: true; pdf: Buffer; fileName: string } | { ok: false; status: 404 | 500 | 503; error: string };

async function render(path: string, kind: "assessment" | "assessment-findings", tokenId: string, host: string | null, proto: string | null, waitFor?: string): Promise<{ ok: true; pdf: Buffer } | Extract<ReportRender, { ok: false }>> {
  const secret = process.env.AUTH_SECRET || "";
  if (!secret) return { ok: false, status: 503, error: REPORT_NO_SECRET };
  const where = printOriginFor(process.env, host, proto);
  if ("error" in where) return { ok: false, status: 503, error: where.error };
  const t = signPrintToken(secret, kind, tokenId, Date.now());
  const pdf = await renderPrintRouteToPdf(`${where.origin}${path}?t=${encodeURIComponent(t)}`, {
    timeoutMs: REPORT_RENDER_STEP_MS,
    signal: AbortSignal.timeout(REPORT_RENDER_DEADLINE_MS),
    ...(waitFor ? { waitFor } : {}),
  });
  return { ok: true, pdf };
}

function failure(e: unknown, what: string): Extract<ReportRender, { ok: false }> {
  if (e instanceof PdfRenderUnavailable) return { ok: false, status: 503, error: e.message };
  console.error(`[assessments] ${what} PDF render failed`, e);
  return { ok: false, status: 500, error: REPORT_RENDER_FAILED };
}

/** `host` / `proto`: the request's (x-forwarded-)host and proto — printOriginFor decides the origin. */
export async function renderAssessmentPdf(id: string, host: string | null, proto: string | null): Promise<ReportRender> {
  try {
    if (typeof id !== "string" || !/^AS-\d{1,9}$/.test(id)) return { ok: false, status: 404, error: "Not found" };
    const a = await getAssessment(id);
    if (!a) return { ok: false, status: 404, error: "Not found" };
    const site = await getSite(a.siteId);
    const r = await render(`/print/assessment/${encodeURIComponent(a.id)}`, "assessment", a.id, host, proto, REPORT_WAIT_FOR);
    if (!r.ok) return r;
    return { ok: true, pdf: r.pdf, fileName: assessmentPdfName(a.id, siteDisplayName(site, a.siteId)) };
  } catch (e) {
    return failure(e, "assessment report");
  }
}

/** The findings-only PDF for `site:<id>` / `company:<id>`. */
export async function renderFindingsPdf(scope: string, host: string | null, proto: string | null): Promise<ReportRender> {
  try {
    const parsed = parseFindingsScope(scope);
    if (!parsed) return { ok: false, status: 404, error: "Not found" };
    // A light name lookup for the file name (the print route does the real load); unknown venue / company is a 404.
    let subject: string;
    if (parsed.kind === "site") {
      const site = await getSite(parsed.id);
      if (!site) return { ok: false, status: 404, error: "Not found" };
      subject = siteDisplayName(site, site.id);
    } else {
      const company = await getCompany(parsed.id);
      if (!company) return { ok: false, status: 404, error: "Not found" };
      subject = company.name;
    }
    const r = await render(`/print/assessment-findings/${encodeURIComponent(parsed.scope)}`, "assessment-findings", parsed.scope, host, proto);
    if (!r.ok) return r;
    return { ok: true, pdf: r.pdf, fileName: findingsPdfName(subject, Date.now()) };
  } catch (e) {
    return failure(e, "findings report");
  }
}

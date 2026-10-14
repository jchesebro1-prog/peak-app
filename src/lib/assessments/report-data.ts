/* Assessments engine (#337, Task 10) — the report loaders, shared by the in-app report page, the signed print routes
   and the PDF renders. Server-only (stores, Blob). The shaping itself is the pure report-model.ts. */
import letterhead from "@/app/(app)/estimator/peak-letterhead.jpg";
import { getDef } from "@/lib/assessments/defs";
import type { AssessmentDef } from "@/lib/assessments/defs/types";
import { photoBytes } from "@/lib/assessments/photo-bytes";
import { coverFooterLine } from "@/lib/estimate-output/cover";
import { getCompany } from "@/lib/identity/companies";
import type { SiteRow } from "@/db/schema";
import { getSite, sitesForCompanies } from "@/lib/identity/sites";
import { getSettings } from "@/lib/settings";
import { getPicklistExtras, type PicklistExtras } from "@/lib/stores/assessment-picklists";
import { getAssessment, type Assessment } from "@/lib/stores/assessments";
import { getEstimateOutputDefaults } from "@/lib/stores/estimate-output-defaults";
import { listFindings, type Finding } from "@/lib/stores/findings";
import { getVenueProfile, profileValues, type VenueProfile } from "@/lib/stores/venue-profiles";
import { allUsers } from "@/lib/users";
import {
  buildAssessmentReport, buildFindingsReport, inlinePhotoSources, parseFindingsScope,
  type AssessmentReportModel, type FindingsReportModel, type FindingsScope,
} from "./report-model";

/** The full baked Peak letterhead (#331, D853) — the same image and footer line the estimate cover prints. */
export interface ReportLetterhead { src: string; companyName: string; footerLine: string }

async function loadLetterhead(): Promise<ReportLetterhead> {
  const [settings, defaults] = await Promise.all([getSettings(), getEstimateOutputDefaults()]);
  const companyName = settings.companyName || "Peak Systems Group";
  return { src: letterhead.src, companyName, footerLine: coverFooterLine({ companyName, offices: settings.offices, website: defaults.website }) };
}

export function siteDisplayName(s: Pick<SiteRow, "name" | "locationName" | "id"> | null | undefined, fallback = ""): string {
  return s?.name || s?.locationName || fallback;
}

function siteAddress(s: SiteRow | null): string {
  if (!s) return "";
  const stateZip = [s.state, s.zip].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
  return [s.address, s.city, stateZip].map((x) => (x ?? "").trim()).filter(Boolean).join(", ");
}

export interface AssessmentReportData {
  assessment: Assessment;
  def: AssessmentDef;
  customer: { id: string; name: string };
  venue: { id: string; name: string; address: string };
  profile: VenueProfile | null;
  extras: PicklistExtras;
  /** every finding raised at this assessment, voided ones included */
  findings: Finding[];
  /** the shaped report (seven sections) */
  model: AssessmentReportModel;
  letterhead: ReportLetterhead;
}

/** Everything the assessment report prints, or null for an unknown id. */
export async function loadAssessmentReport(id: string, now = Date.now()): Promise<AssessmentReportData | null> {
  if (typeof id !== "string" || !/^AS-\d{1,9}$/.test(id)) return null;
  const assessment = await getAssessment(id);
  if (!assessment) return null;
  const def = getDef(assessment.defVersion);
  const [company, site, profile, extras, findings, users, lh] = await Promise.all([
    getCompany(assessment.customerId),
    getSite(assessment.siteId),
    getVenueProfile(assessment.siteId),
    getPicklistExtras(),
    listFindings({ assessmentId: assessment.id, includeVoided: true }),
    allUsers(),
    loadLetterhead(),
  ]);
  const customer = { id: assessment.customerId, name: company?.name ?? assessment.customerId };
  const venue = { id: assessment.siteId, name: siteDisplayName(site, assessment.siteId), address: siteAddress(site) };
  const assessor = users.find((u) => u.id === assessment.assessorId)?.name ?? assessment.assessorId;
  const model = buildAssessmentReport({
    assessment, def, extras, profile: profileValues(profile), findings,
    names: { customer: customer.name, venue: venue.name, address: venue.address, assessor }, now,
  });
  return { assessment, def, customer, venue, profile, extras, findings, model, letterhead: lh };
}

/** The print route's photos as data URIs (≤ 4 reads at a time, ≤ 40 MB in all; pending / unreadable → null). */
export function inlineReportPhotos(assessment: Assessment): ReturnType<typeof inlinePhotoSources> {
  return inlinePhotoSources(assessment.photos, (pid) => photoBytes(assessment, pid));
}

export interface FindingsReportData {
  scope: FindingsScope;
  /** the venue or company name the report is about */
  subject: string;
  customerName: string;
  model: FindingsReportModel;
  letterhead: ReportLetterhead;
}

/** The open findings (not voided, not closed) for one venue or one company, or null for an unknown scope. */
export async function loadFindingsReport(raw: string, now = Date.now()): Promise<FindingsReportData | null> {
  const parsed = parseFindingsScope(raw);
  if (!parsed) return null;
  let customerId: string;
  let subject: string;
  let siteNames: Record<string, string>;
  if (parsed.kind === "site") {
    const site = await getSite(parsed.id);
    if (!site) return null;
    customerId = site.companyId;
    subject = siteDisplayName(site, site.id);
    siteNames = { [site.id]: subject };
  } else {
    const company = await getCompany(parsed.id);
    if (!company) return null;
    customerId = company.id;
    subject = company.name;
    siteNames = Object.fromEntries((((await sitesForCompanies([company.id])).get(company.id)) ?? []).map((s) => [s.id, siteDisplayName(s, s.id)]));
  }
  const [company, findings, lh] = await Promise.all([
    parsed.kind === "site" ? getCompany(customerId) : Promise.resolve(null),
    listFindings(parsed.kind === "site" ? { siteId: parsed.id, customerId } : { customerId }),
    loadLetterhead(),
  ]);
  const customerName = parsed.kind === "site" ? company?.name ?? customerId : subject;
  return { scope: parsed.scope, subject, customerName, model: buildFindingsReport({ findings, subject, siteNames, now }), letterhead: lh };
}

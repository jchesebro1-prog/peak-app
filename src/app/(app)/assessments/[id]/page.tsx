import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { blobEnabled } from "@/lib/blob";
import { getAssessment } from "@/lib/stores/assessments";
import { getVenueProfile } from "@/lib/stores/venue-profiles";
import { getPicklistExtras } from "@/lib/stores/assessment-picklists";
import { listFindings } from "@/lib/stores/findings";
import { getCompany } from "@/lib/identity/companies";
import { docLocId, getSite } from "@/lib/identity/sites";
import { allUsers } from "@/lib/users";
import { codeInUse } from "@/lib/assessments/findings-model";
import { toFindingVM } from "@/lib/assessments/editor-model";
import type { EditorDoc, EditorProps, FindingVM } from "../types";
import AssessmentEditor from "./editor";

export const metadata = { title: "Assessment — Quartzite-6" };

/** The assessment editor (#337, spec §2). Loads everything server-side and hands the client editor plain props;
 *  the client never imports a store. */
export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, a] = await Promise.all([requireUser(), getAssessment(id)]);
  if (!a) notFound();
  const [profile, extras, findings, company, site, users] = await Promise.all([
    getVenueProfile(a.siteId),
    getPicklistExtras(),
    listFindings({ assessmentId: a.id, includeVoided: true }),
    getCompany(a.customerId),
    getSite(a.siteId),
    allUsers(),
  ]);

  // A JSON round trip guarantees a plain, serializable object (no undefined-vs-missing surprises for the client).
  const doc = JSON.parse(JSON.stringify(a)) as EditorDoc;
  const findingVMs: FindingVM[] = JSON.parse(JSON.stringify(findings.map(toFindingVM)));
  // Codes lock once a live finding of this customer carries them (changing one then needs `approve`).
  const customerFindings = await listFindings({ customerId: a.customerId });
  const companyCode = company?.shortCode ?? null;
  const siteCode = site?.shortCode ?? null;

  const props: EditorProps = {
    doc,
    me: { id: user.id, name: user.name },
    customerName: company?.name ?? a.customerId,
    siteName: site?.name || site?.locationName || a.siteId,
    profile: JSON.parse(JSON.stringify(profile?.facts ?? {})),
    picklistExtras: JSON.parse(JSON.stringify(extras)),
    findings: findingVMs,
    blobEnabled: blobEnabled(),
    userNames: Object.fromEntries(users.map((u) => [u.id, u.name])),
    canEdit: can("create", user.roles),
    canReopen: can("approve", user.roles),
    codes: {
      companyId: a.customerId,
      siteId: a.siteId,
      company: companyCode,
      site: siteCode,
      companyLocked: codeInUse(customerFindings, companyCode, "company"),
      siteLocked: codeInUse(customerFindings.filter((f) => f.siteId === a.siteId), siteCode, "site"),
    },
    venueLocId: site ? docLocId(site) : null,
  };

  return <AssessmentEditor {...props} />;
}

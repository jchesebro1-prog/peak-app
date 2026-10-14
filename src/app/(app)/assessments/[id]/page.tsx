import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { blobEnabled } from "@/lib/blob";
import { getAssessment } from "@/lib/stores/assessments";
import { getVenueProfile } from "@/lib/stores/venue-profiles";
import { getPicklistExtras } from "@/lib/stores/assessment-picklists";
import { listFindings } from "@/lib/stores/findings";
import { getCompany } from "@/lib/identity/companies";
import { getSite } from "@/lib/identity/sites";
import { allUsers } from "@/lib/users";
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
  const findingVMs: FindingVM[] = findings.map((f) => ({
    key: f.key,
    printedId: f.printedId,
    category: f.category,
    rating: f.rating,
    description: f.description ?? "",
    questionKeys: f.questionKeys,
    ...(f.ruleId ? { ruleId: f.ruleId } : {}),
    status: f.status,
    voided: !!f.voided,
    photoIds: f.photoIds,
  }));

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
  };

  return <AssessmentEditor {...props} />;
}

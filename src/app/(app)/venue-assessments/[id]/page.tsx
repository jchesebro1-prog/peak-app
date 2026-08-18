import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  get,
  FLOOR_TYPES,
  LIFT_TYPES,
  LIFT_SUPPLIERS,
  INSTALL_TIMEFRAMES,
  CONDITIONS,
  STAGES,
  STAGE_META,
  MEASURE_GROUPS,
} from "@/lib/stores/surveys";
import { mergedCatalog } from "@/lib/stores/survey-intake";
import { all as allCustomers } from "@/lib/stores/customers";
import { activeUsers } from "@/lib/users";
import { getSettings } from "@/lib/settings";
import { resolveCerts } from "@/lib/venue-assessment-certs";
import { resolveVenueDoctrine } from "@/lib/venue-doctrine";
import SurveyEditor, { type EditorMeta, type EditorCustomer } from "./controls";

export const metadata = { title: "Site survey — Quartzite-6" };

export default async function SurveyEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [, rec, customers, users, settings] = await Promise.all([
    requireUser(),
    get(id),
    allCustomers(),
    activeUsers(),
    getSettings(),
  ]);
  if (!rec) notFound();
  const autoCerts = await resolveCerts(rec.customerId, rec.locationId);

  const editorCustomers: EditorCustomer[] = customers.map((cst) => {
    const contacts = cst.contacts || [];
    const pc = contacts.find((ct) => ct.primary) || contacts[0] || null;
    return {
      id: cst.id,
      name: cst.name,
      type: cst.type || "",
      location: cst.location || "",
      locations: (cst.locations || []).map((l) => ({
        id: l.id || "",
        label: l.label || "",
        primary: !!l.primary,
        city: l.city || "",
        state: l.state || "",
      })),
      primaryContact: pc ? { name: pc.name || "", email: pc.email || "" } : null,
    };
  });

  // The quick-measurement set is the venue class's own field set, derived in
  // the editor from venue-classes.ts (a pure module it imports directly), so
  // no per-venue-type measurement map is serialized here any more.
  const meta: EditorMeta = {
    floorTypes: FLOOR_TYPES,
    liftTypes: LIFT_TYPES,
    liftSuppliers: LIFT_SUPPLIERS,
    installTimeframes: INSTALL_TIMEFRAMES,
    conditions: CONDITIONS,
    stages: STAGES,
    stageMeta: STAGE_META,
    measureGroups: MEASURE_GROUPS,
    intakeCatalog: mergedCatalog(settings.intakeCatalog),
    autoCerts,
    venueDoctrine: resolveVenueDoctrine(settings.venueDoctrine),
  };

  const roster = users.map((u) => u.name);

  return <SurveyEditor record={rec} customers={editorCustomers} roster={roster} meta={meta} />;
}

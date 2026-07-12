import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  get,
  measureFields,
  VENUE_TYPES,
  VISIT_TYPES,
  FLOOR_TYPES,
  LIFT_TYPES,
  LIFT_SUPPLIERS,
  INSTALL_TIMEFRAMES,
  CONDITIONS,
  STAGES,
  STAGE_META,
  MEASURE_GROUPS,
  type MeasureField,
} from "@/lib/stores/surveys";
import { mergedCatalog } from "@/lib/stores/survey-intake";
import { all as allCustomers } from "@/lib/stores/customers";
import { activeUsers } from "@/lib/users";
import { getSettings } from "@/lib/settings";
import SurveyEditor, { type EditorMeta, type EditorCustomer } from "./controls";

export const metadata = { title: "Site survey — Peak Backend" };

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

  // measureFields() is venue-type driven; serialize the whole map so the
  // client editor can switch the quick-measurement set as venueType changes.
  const measureFieldsByType: Record<string, MeasureField[]> = {};
  VENUE_TYPES.forEach((vt) => {
    measureFieldsByType[vt] = measureFields(vt);
  });
  const defaultMeasureFields = measureFields("");

  const meta: EditorMeta = {
    venueTypes: VENUE_TYPES,
    visitTypes: VISIT_TYPES,
    floorTypes: FLOOR_TYPES,
    liftTypes: LIFT_TYPES,
    liftSuppliers: LIFT_SUPPLIERS,
    installTimeframes: INSTALL_TIMEFRAMES,
    conditions: CONDITIONS,
    stages: STAGES,
    stageMeta: STAGE_META,
    measureGroups: MEASURE_GROUPS,
    measureFieldsByType,
    defaultMeasureFields,
    intakeCatalog: mergedCatalog(settings.intakeCatalog),
  };

  const roster = users.map((u) => u.name);

  return <SurveyEditor record={rec} customers={editorCustomers} roster={roster} meta={meta} />;
}

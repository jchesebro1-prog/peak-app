import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  get,
  VENUE_TYPES,
  CONDITIONS,
  SEVERITIES,
  SEVERITY_META,
  STAGES,
  STAGE_META,
  STATUS_META,
  RUBRIC_RATINGS,
  RUBRIC_TEMPLATE,
  RUBRIC_LETTERS,
  ISSUE_LIBRARY,
  libraryCategories,
  MEASUREMENT_GROUPS,
  VENUE_FACTS,
  SYSTEM_FIELDS,
} from "@/lib/stores/inspections";
import { all as allCustomers } from "@/lib/stores/customers";
import { activeUsers } from "@/lib/users";
import InspectionEditor, { type EditorMeta, type EditorCustomer } from "./controls";
import { loadPrefillPanels, loadRecordingsStrip } from "../../recordings/data";
import ActionError from "@/components/action-error";

export const metadata = { title: "Inspection — Quartzite-6" };

export default async function InspectionEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([
    params,
    searchParams,
  ]);
  const [, rec, customers, users] = await Promise.all([
    requireUser(),
    get(id),
    allCustomers(),
    activeUsers(),
  ]);
  if (!rec) notFound();
  // Recordings (spec §4.4/§6): header strip + "From recording" prefill
  // panels — server half computed here, rendered inside the client editor.
  const [recordings, fromRecording] = await Promise.all([
    loadRecordingsStrip("inspection", rec.id),
    loadPrefillPanels("inspection", rec.id),
  ]);

  const editorCustomers: EditorCustomer[] = customers.map((c) => {
    const contacts = c.contacts || [];
    const pc = contacts.find((ct) => ct.primary) || contacts[0] || null;
    return {
      id: c.id,
      name: c.name,
      locations: (c.locations || []).map((l) => ({
        id: l.id || "",
        label: l.label || "",
        city: l.city || "",
        state: l.state || "",
      })),
      primaryContact: pc ? { name: pc.name || "", email: pc.email || "" } : null,
    };
  });

  const meta: EditorMeta = {
    venueTypes: VENUE_TYPES,
    conditions: CONDITIONS.map((c) => ({ key: c.key, label: c.label })),
    severities: SEVERITIES.map((s) => ({ key: s.key, label: s.label })),
    severityMeta: SEVERITY_META,
    stages: STAGES,
    stageMeta: STAGE_META,
    statusMeta: STATUS_META,
    rubricRatings: RUBRIC_RATINGS,
    rubricTemplate: RUBRIC_TEMPLATE,
    rubricLetters: RUBRIC_LETTERS,
    issueLibrary: ISSUE_LIBRARY,
    libraryCategories: libraryCategories(),
    measurementGroups: MEASUREMENT_GROUPS,
    venueFacts: VENUE_FACTS,
    systemFields: SYSTEM_FIELDS,
  };

  const roster = users.map((u) => u.name);

  return (
    <>
      <ActionError message={Array.isArray(sp.err) ? sp.err[0] : sp.err} />
      <InspectionEditor
        record={rec}
        customers={editorCustomers}
        roster={roster}
        meta={meta}
        recordings={recordings.recordings}
        canShowRecord={recordings.canRecord}
        fromRecording={fromRecording}
      />
    </>
  );
}

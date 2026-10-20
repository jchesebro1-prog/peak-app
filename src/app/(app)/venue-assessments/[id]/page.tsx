import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  get,
  FLOOR_TYPES,
  LIFT_TYPES,
  LIFT_SUPPLIERS,
  INSTALL_TIMEFRAMES,
  STAGES,
  STAGE_META,
  MEASURE_GROUPS,
} from "@/lib/stores/surveys";
import { mergedCatalog } from "@/lib/stores/survey-intake";
import { fabricPartsByCategory } from "@/lib/stores/catalog";
import { all as allCustomers } from "@/lib/stores/customers";
import { activeUsers } from "@/lib/users";
import { getSettings } from "@/lib/settings";
import SurveyEditor, { type EditorMeta, type EditorCustomer } from "./controls";
import { resolveCerts } from "@/lib/venue-assessment-certs";
import { resolveSurveyTags } from "@/lib/survey-tags";
import { loadPrefillPanels, loadRecordingsStrip } from "../../recordings/data";
import ActionError from "@/components/action-error";
import { MeetingsCard } from "@/components/meetings/meetings-card";
import { visitIdsForSurvey } from "@/lib/stores/site-visits";
import { estimateSuggestEnabled, suggestionReadyHref } from "@/lib/assist/suggest-entry-server";
import { surveyTravelSuggestion } from "@/lib/survey-travel-server";
import { blobEnabled } from "@/lib/blob";

export const metadata = { title: "Site survey — Quartzite-6" };

export default async function SurveyEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [user, rec, customers, users, settings] = await Promise.all([
    requireUser(),
    get(id),
    allCustomers(),
    activeUsers(),
    getSettings(),
  ]);
  if (!rec) notFound();
  // Recordings (spec §4.4/§6): header strip + "From recording" prefill
  // panels. Both are client-rendered inside the editor, so the server half
  // (store reads + record gate) is computed here and passed down.
  // Curtains are in play when the discipline is active or in scope, or the scope is still unanswered (shows every discipline).
  const needsFabric =
    (rec.disciplinesActive || []).includes("curtain") || !(rec.scope && rec.scope.length) || rec.scope.includes("curtain");
  const [autoCerts, recordings, fromRecording, visitIds, canSuggest, fabricRows, travelSuggestion] = await Promise.all([
    resolveCerts(rec.customerId, rec.locationId),
    loadRecordingsStrip("survey", rec.id),
    loadPrefillPanels("survey", rec.id),
    visitIdsForSurvey(rec.id),
    estimateSuggestEnabled(user.id),
    // #344 B4 — the curtain rows' Fabric type suggestions; a failed read just means no datalist.
    needsFabric ? fabricPartsByCategory().catch(() => []) : Promise.resolve([] as Awaited<ReturnType<typeof fabricPartsByCategory>>),
    // #344 B5 — one-way drive from the office to a verified venue address; null (never a throw) otherwise.
    surveyTravelSuggestion(rec),
  ]);
  const fabricOptions = [...new Set(fabricRows.map((p) => (p.desc || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 500);
  // Estimate suggestion (spec 2026-10-13 §3) — the header's Suggest estimate
  // (pilot + `estimate`) and this assessment's latest suggestion.
  const suggestionHref = canSuggest ? await suggestionReadyHref("survey", rec.id) : null;

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
    stages: STAGES,
    stageMeta: STAGE_META,
    measureGroups: MEASURE_GROUPS,
    intakeCatalog: mergedCatalog(settings.intakeCatalog),
    autoCerts,
    internalTags: resolveSurveyTags(settings.surveyInternalTags),
    fabricOptions,
  };

  const roster = users.map((u) => u.name);

  return (
    <>
      <ActionError message={Array.isArray(sp.err) ? sp.err[0] : sp.err} />
      <SurveyEditor
        record={rec}
        customers={editorCustomers}
        roster={roster}
        meta={meta}
        recordings={recordings.recordings}
        canShowRecord={recordings.canRecord}
        fromRecording={fromRecording}
        canSuggest={canSuggest}
        suggestionHref={suggestionHref}
        travelSuggestion={travelSuggestion}
        // #344 C5 — photos upload to private Blob when it is configured, else (local dev) inline
        blobEnabled={blobEnabled()}
        me={user.id}
        // #323 — Krisp meetings linked to this survey or one of its site visits (site visits have no page of
        // their own; their meetings show here, like their recordings do).
        meetingsSlot={<MeetingsCard kind="work" id={[rec.id, ...visitIds]} viewerId={user.id} />}
      />
    </>
  );
}

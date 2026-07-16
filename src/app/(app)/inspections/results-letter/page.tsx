import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import {
  get,
  counts,
  levelMeta,
  conditionMeta,
  fmtLong,
} from "@/lib/stores/inspections";
import { locationById } from "@/lib/stores/customers";
import { renderField } from "@/lib/templates";
import {
  SinglePageLetter,
  type LetterMetaRow,
} from "@/components/letter/SinglePageLetter";
import { DocNotFound, oneParam, conditionWord, officePhone } from "../../_letters/util";

export const metadata = { title: "Rigging inspection results — Peak Backend" };

/**
 * Rigging Inspection Results Letter — the single-page client confirmation of
 * findings, generated from a completed inspection's real data and the
 * `inspection_results_letter` template. Deep-linked as
 * /inspections/results-letter?id=<inspectionId>.
 */
export default async function InspectionResultsLetterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, settings] = await Promise.all([
    requireUser(),
    searchParams,
    getSettings(),
  ]);
  const id = oneParam(sp.id);
  const rec = id ? await get(id) : null;
  const companyName = settings.companyName || "Peak Systems Group";
  const accent = settings.accent || "#7b3f8a";
  if (!rec) return <DocNotFound backHref="/inspections" label="inspection" />;

  let city = "";
  let state = "";
  if (rec.customerId) {
    const loc = await locationById(rec.customerId, rec.locationId);
    if (loc) {
      city = loc.city || "";
      state = loc.state || "";
    }
  }
  const location = [city, state].filter(Boolean).join(", ") || rec.address || "—";
  const c = counts(rec);
  const condition = conditionWord(conditionMeta(rec.condition).label);
  const lm = levelMeta(rec.level);
  const venue = rec.customer || rec.venue || "the venue";

  const vars = {
    company: companyName,
    venue,
    location,
    surveyDate: fmtLong(rec.surveyDate),
    reportNo: rec.id,
    inspector: rec.inspector,
    condition,
    urgentCount: c.urgent.open,
    necessaryCount: c.necessary.open,
    basicCount: c.basic.open,
    closedCount: c.closed,
  };
  const t = (f: string) =>
    renderField(settings.templates, "inspection_results_letter", f, vars);

  const meta: LetterMetaRow[] = [
    { label: "Prepared For", value: venue },
    { label: "Venue / Room", value: rec.venue || rec.venueType || "—" },
    { label: "Location", value: location },
    { label: "Survey Date", value: fmtLong(rec.surveyDate) },
    { label: "Inspector", value: rec.inspector || "—" },
    { label: "Report No.", value: rec.id },
    { label: "Inspection Type", value: `Rigging · ${lm.label}` },
    { label: "Overall Condition", value: condition },
  ];

  return (
    <SinglePageLetter
      accent={accent}
      companyName={companyName}
      logoDark={settings.logoDark}
      eyebrow="Rigging Inspection · OSHA / ANSI E1"
      title="Rigging Inspection Results"
      subtitle="Single-Page Client Confirmation of Findings"
      statusLabel={condition}
      meta={meta}
      sections={[
        { paragraphs: [t("intro")] },
        { heading: "Visual Scope", paragraphs: [t("visualScope")] },
        { heading: "Results", paragraphs: [t("resultsLine"), t("priorityGuidance")] },
        { paragraphs: [t("retainNote")] },
      ]}
      terms={{
        heading: "Priority Terms",
        items: [
          { term: "Urgent Repair", desc: t("termUrgent") },
          { term: "Necessary Repair", desc: t("termNecessary") },
          { term: "Basic Improvement", desc: t("termBasic") },
        ],
      }}
      footer={`Questions may be directed to ${rec.inspector || rec.owner || companyName} · ${companyName} · Office: ${officePhone(settings)} · ${rec.contactEmail || ""}`}
      backHref={`/inspections/${encodeURIComponent(rec.id)}`}
      backLabel="← Inspection"
    />
  );
}

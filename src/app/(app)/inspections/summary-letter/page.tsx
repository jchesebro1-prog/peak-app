import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import {
  get,
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
import { INSPECTION_LIMITATION_NOTICE } from "@/lib/compliance-notices";

export const metadata = { title: "Rigging inspection summary — Quartzite-6" };

/** Next inspection cycle = survey date + the level's interval (in years). */
function nextCycleIso(surveyIso: string, years: number): string {
  if (!surveyIso) return "";
  const d = new Date(surveyIso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  d.setFullYear(d.getFullYear() + (years || 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Rigging Inspection Summary Letter — the single-page administrative record
 * for owner files / insurers / AHJs, generated from a completed inspection
 * and the `inspection_summary_letter` template. Deep-linked as
 * /inspections/summary-letter?id=<inspectionId>.
 */
export default async function InspectionSummaryLetterPage({
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
  const condition = conditionWord(conditionMeta(rec.condition).label);
  const lm = levelMeta(rec.level);
  const venue = rec.customer || rec.venue || "the venue";
  const nextCycle = fmtLong(nextCycleIso(rec.surveyDate, lm.years));

  const vars = {
    company: companyName,
    venue,
    location,
    surveyDate: fmtLong(rec.surveyDate),
    reportDate: fmtLong(rec.reportDate),
    inspector: rec.inspector,
    condition,
    nextCycle,
  };
  const t = (f: string) =>
    renderField(settings.templates, "inspection_summary_letter", f, vars);

  const meta: LetterMetaRow[] = [
    { label: "Prepared For", value: venue },
    { label: "Venue / Room", value: rec.venue || rec.venueType || "—" },
    { label: "Location", value: location },
    { label: "Survey Date", value: fmtLong(rec.surveyDate) },
    { label: "Report Date", value: fmtLong(rec.reportDate) },
    { label: "Inspector", value: rec.inspector || "—" },
    { label: "Overall Condition", value: condition },
    { label: "Next Cycle", value: nextCycle },
  ];

  return (
    <SinglePageLetter
      accent={accent}
      companyName={companyName}
      logoDark={settings.logoDark}
      eyebrow="Rigging Inspection · OSHA / ANSI E1"
      title="Rigging Inspection Summary"
      subtitle="Single-Page Administrative Record"
      statusLabel={condition}
      meta={meta}
      sections={[
        { paragraphs: [t("purpose")] },
        { heading: "Summary Statement", paragraphs: [t("summaryStatement")] },
        { heading: "Scope of This Inspection", paragraphs: [t("scopeNote")] },
        { heading: "Outcome Summary", paragraphs: [t("outcomeSummary")] },
        { paragraphs: [t("countInterpretation")] },
        { heading: "Disclaimer", paragraphs: [t("disclaimer")] },
      ]}
      notice={INSPECTION_LIMITATION_NOTICE}
      footer={`Prepared by ${rec.inspector || rec.owner || companyName} · ${companyName} · Office: ${officePhone(settings)}`}
      backHref={`/inspections/${encodeURIComponent(rec.id)}`}
      backLabel="← Inspection"
    />
  );
}

import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { get, fmtLong } from "@/lib/stores/flame-jobs";
import { renderField } from "@/lib/templates";
import {
  SinglePageLetter,
  type LetterMetaRow,
} from "@/components/letter/SinglePageLetter";
import { DocNotFound, oneParam, officePhone, flameTotals } from "../../_letters/util";
import { FLAME_TEST_LIMITATION_NOTICE } from "@/lib/compliance-notices";

export const metadata = { title: "Flame-test summary — Quartzite-6" };

const YEAR = 365 * 24 * 60 * 60 * 1000;

/**
 * Field Flame Inspection Summary Letter — the single-page administrative
 * record for owner / compliance / AHJ files, generated from a completed flame
 * job and the `flame_summary_letter` template. Deep-linked as
 * /flame-tests/summary-letter?job=<flameJobId>.
 */
export default async function FlameSummaryLetterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, settings] = await Promise.all([
    requireUser(),
    searchParams,
    getSettings(),
  ]);
  const id = oneParam(sp.job);
  const job = id ? await get(id) : null;
  const companyName = settings.companyName || "Peak Systems Group";
  const accent = settings.accent || "#7b3f8a";
  if (!job) return <DocNotFound backHref="/flame-tests" label="flame test" />;

  const v0 = job.venues?.[0];
  const location = [v0?.city, v0?.state].filter(Boolean).join(", ") || job.venue || "—";
  const totals = flameTotals(job);
  const datePerformed = fmtLong(job.completedAt);
  const goodThrough = fmtLong(job.dueAt || (job.completedAt || Date.now()) + YEAR);
  const technician = job.results?.performedBy || job.assignedTo || job.owner || "—";
  const certNo = (job.results?.cert || "").trim() || "—";
  const venue = job.customer || job.venue || "the venue";
  const statusLabel =
    totals.failed > 0 || job.results?.overall === "fail" ? "Action Required" : "Passed";

  const vars = {
    company: companyName,
    venue,
    location,
    datePerformed,
    technician,
    certNo,
    unitsTested: totals.tested,
    goodThrough,
    passedCount: totals.passed,
    ifrCount: totals.retreated,
    failedCount: totals.failed,
  };
  const t = (f: string) =>
    renderField(settings.templates, "flame_summary_letter", f, vars);

  const meta: LetterMetaRow[] = [
    { label: "Prepared For", value: venue },
    { label: "Attn", value: job.contact?.name || "—" },
    { label: "Location", value: location },
    { label: "Date Performed", value: datePerformed },
    { label: "Technician", value: technician },
    { label: "Certificate #", value: certNo },
    { label: "Units Tested", value: String(totals.tested) },
    { label: "Good Through", value: goodThrough },
  ];

  return (
    <SinglePageLetter
      accent={accent}
      companyName={companyName}
      logoDark={settings.logoDark}
      eyebrow="NFPA 705 · Field Flame Test"
      title="Field Flame Inspection Summary"
      subtitle="Single-Page Administrative Record"
      statusLabel={statusLabel}
      meta={meta}
      sections={[
        { paragraphs: [t("purpose")] },
        { heading: "Summary Statement", paragraphs: [t("summaryStatement")] },
        { paragraphs: [t("nfpaQuote")] },
        { heading: "Outcome Summary", paragraphs: [t("outcomeSummary")] },
        { heading: "NFPA 705 in Brief", paragraphs: [t("inBrief")] },
      ]}
      terms={{
        heading: "Result Terms",
        items: [
          { term: "Passed", desc: t("termPassed") },
          { term: "IFR — Inherently Flame Retardant", desc: t("termIFR") },
          { term: "Failed", desc: t("termFailed") },
        ],
      }}
      notice={FLAME_TEST_LIMITATION_NOTICE}
      footer={`Prepared by ${technician} · ${companyName} · Office: ${officePhone(settings)}`}
      backHref={`/flame-tests/results?job=${encodeURIComponent(job.id)}`}
      backLabel="← Flame test"
    />
  );
}

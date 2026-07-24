import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { get, fmtLong } from "@/lib/stores/flame-jobs";
import { renderField } from "@/lib/templates";
import {
  SinglePageLetter,
  type LetterMetaRow,
} from "@/components/letter/SinglePageLetter";
import { DocNotFound, oneParam, officePhone, flameTotals } from "../../_letters/util";

export const metadata = { title: "Flame-test results — Quartzite" };

const YEAR = 365 * 24 * 60 * 60 * 1000;

/**
 * Field Flame Inspection Results Letter — the single-page client confirmation
 * of findings, generated from a completed flame job and the
 * `flame_results_letter` template. Deep-linked as
 * /flame-tests/results-letter?job=<flameJobId>.
 */
export default async function FlameResultsLetterPage({
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
    renderField(settings.templates, "flame_results_letter", f, vars);

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
      title="Field Flame Inspection Results"
      subtitle="Single-Page Client Confirmation of Findings"
      statusLabel={statusLabel}
      meta={meta}
      sections={[
        { paragraphs: [t("intro")] },
        { paragraphs: [t("nfpaQuote")] },
        { heading: "Results", paragraphs: [t("resultsLine"), t("findingsNote")] },
        { paragraphs: [t("failedNote"), t("retainNote")] },
      ]}
      footer={`Questions may be directed to ${technician} · ${companyName} · Office: ${officePhone(settings)} · ${job.contact?.email || ""}`}
      backHref={`/flame-tests/results?job=${encodeURIComponent(job.id)}`}
      backLabel="← Flame test"
    />
  );
}

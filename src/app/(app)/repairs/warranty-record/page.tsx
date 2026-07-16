import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import {
  get,
  fmtLong,
  warrantyExpiryOf,
  warrantyStatus,
} from "@/lib/stores/repair-jobs";
import { renderField } from "@/lib/templates";
import {
  SinglePageLetter,
  type LetterMetaRow,
} from "@/components/letter/SinglePageLetter";
import { DocNotFound, oneParam, officePhone } from "../../_letters/util";

export const metadata = { title: "Warranty & repair record — Peak Backend" };

const WARRANTY_STATUS_LABEL: Record<string, string> = {
  active: "Warranty Active",
  expiring: "Warranty Expiring",
  expired: "Warranty Expired",
  none: "No Warranty On File",
};

/**
 * Warranty & Repair Record — the internal single-page tracker for a warranty
 * callback or follow-up tied to earlier work, generated from a repair and the
 * `warranty_record` template. Deep-linked as
 * /repairs/warranty-record?job=<repairId>.
 */
export default async function WarrantyRecordPage({
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
  if (!job) return <DocNotFound backHref="/repairs" label="repair" />;

  const venue = job.customer || job.venue || "the venue";
  const warrantyThrough = fmtLong(warrantyExpiryOf(job));
  const technician = job.completion?.performedBy || job.assignedTo || "—";
  const wStatus = warrantyStatus(job);

  const vars = {
    company: companyName,
    venue,
    warrantyThrough,
    technician,
  };
  const t = (f: string) =>
    renderField(settings.templates, "warranty_record", f, vars);

  const coveredWork = job.scope?.trim() || job.completion?.workPerformed?.trim() || t("coveredWork");

  const meta: LetterMetaRow[] = [
    { label: "Service Call", value: job.id },
    { label: "Original Completion", value: fmtLong(job.completedAt) },
    { label: "Warranty Through", value: warrantyThrough },
    { label: "Original Report", value: job.quoteId || job.source?.label || "—" },
    { label: "Reviewed By", value: technician },
    { label: "Resolution Status", value: "Open" },
  ];

  return (
    <SinglePageLetter
      accent={accent}
      companyName={companyName}
      logoDark={settings.logoDark}
      eyebrow="Service Call · Repair / Warranty Tracking"
      title="Warranty & Repair Record"
      subtitle="Coverage, Callback & Resolution Tracker"
      statusLabel={WARRANTY_STATUS_LABEL[wStatus.state] || "Warranty"}
      meta={meta}
      sections={[
        { paragraphs: [t("intro")] },
        { heading: "Covered Work", paragraphs: [coveredWork] },
        { heading: "Reported Issue", paragraphs: [t("reportedIssue")] },
        { heading: "Disposition / Resolution", paragraphs: [t("disposition")] },
      ]}
      terms={{
        heading: "Workmanship Warranty Terms",
        items: [
          { term: "Coverage", desc: t("warrantyCoverage") },
          { term: "If Something Recurs", desc: t("warrantyRecurs") },
          { term: "What Is Not Covered", desc: t("warrantyExcluded") },
        ],
      }}
      footer={`${t("fileNote")}  ·  ${companyName} · Office: ${officePhone(settings)}`}
      backHref={`/repairs/results?job=${encodeURIComponent(job.id)}`}
      backLabel="← Repair"
    />
  );
}

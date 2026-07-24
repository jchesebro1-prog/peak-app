import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import {
  get,
  fmtLong,
  warrantyExpiryOf,
  priorityMeta,
} from "@/lib/stores/repair-jobs";
import { renderField } from "@/lib/templates";
import {
  SinglePageLetter,
  type LetterMetaRow,
} from "@/components/letter/SinglePageLetter";
import { DocNotFound, oneParam, officePhone } from "../../_letters/util";

export const metadata = { title: "Service call completion — Quartzite" };

/**
 * Service Call Completion Letter — the single-page client confirmation of
 * completed repair work, generated from a completed repair and the
 * `service_completion_letter` template. Real completion narrative/parts come
 * from job.completion when present; otherwise the template prompt shows.
 * Deep-linked as /repairs/completion-letter?job=<repairId>.
 */
export default async function ServiceCompletionLetterPage({
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
  const v0 = job.venues?.[0];
  const location = [v0?.city, v0?.state].filter(Boolean).join(", ") || job.venue || "—";
  const warrantyThrough = fmtLong(warrantyExpiryOf(job));
  const partsList =
    (job.completion?.partsUsed?.length
      ? job.completion.partsUsed
      : (job.parts || []).map((p) => `${p.qty}× ${p.name}`)
    ).join(", ") || "—";

  const vars = {
    company: companyName,
    venue,
    contactName: job.contact?.name ?? "",
    serviceNo: job.id,
    completionDate: fmtLong(job.completedAt),
    warrantyThrough,
    partsList,
    billingNote: "Invoice enclosed",
  };
  const t = (f: string) =>
    renderField(settings.templates, "service_completion_letter", f, vars);

  // Prefer the real recorded work / follow-up over the template prompt.
  const completedWork = job.completion?.workPerformed?.trim() || job.scope?.trim() || t("completedWork");
  const followUp = job.completion?.followUp?.trim() || t("followUp");

  const meta: LetterMetaRow[] = [
    { label: "Service Call No.", value: job.id },
    { label: "Completion Date", value: fmtLong(job.completedAt) },
    { label: "Prepared For", value: venue },
    { label: "Attn", value: job.contact?.name || "—" },
    { label: "Location", value: location },
    { label: "Reference", value: job.quoteId || job.source?.label || "—" },
    { label: "Priority", value: priorityMeta(job.priority).label },
    { label: "Warranty Through", value: warrantyThrough },
  ];

  return (
    <SinglePageLetter
      accent={accent}
      companyName={companyName}
      logoDark={settings.logoDark}
      eyebrow="Service Call · Repair / Warranty"
      title="Service Call Completion"
      subtitle="Client Confirmation of Completed Repair Work"
      statusLabel="Completed"
      meta={meta}
      sections={[
        { paragraphs: [t("intro")] },
        { heading: "Completed Work", paragraphs: [completedWork] },
        { paragraphs: [t("partsMaterials")] },
        { heading: "Follow-Up", paragraphs: [followUp] },
        { heading: "Warranty Note", paragraphs: [t("warrantyNote")] },
        { paragraphs: [t("adminNote")] },
      ]}
      footer={`Prepared by ${job.completion?.performedBy || job.owner || companyName} · ${companyName} · Office: ${officePhone(settings)}`}
      backHref={`/repairs/results?job=${encodeURIComponent(job.id)}`}
      backLabel="← Repair"
    />
  );
}

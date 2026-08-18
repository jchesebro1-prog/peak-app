import type { LetterBlock, LetterDoc } from "@/lib/pdf";
import type { SurveyRecord } from "@/lib/stores/surveys";
import { CONDITION_CATEGORIES } from "@/lib/stores/assessment";

/** Printable field sheet. The PDF renderer paginates blocks automatically. */
export function buildAssessmentSheet(record: SurveyRecord, companyName = "Peak Systems Group", accent = "#173f73"): LetterDoc {
  const fields = Object.entries(record.measurements || {}).filter(([, value]) => String(value ?? "").trim());
  const blocks: LetterBlock[] = [
    { kind: "p", text: `${record.venueClass || "venue"} site visit` },
    { kind: "p", text: `Venue type: ${record.venueSubtype || "—"}\nPurpose: ${record.visitPurpose || "—"}\nContact: ${record.contact || "—"} ${record.contactPhone ? `· ${record.contactPhone}` : ""}` },
    { kind: "p", text: "Measurements" },
    { kind: "p", text: fields.length ? fields.map(([key, value]) => `${key}: ${value}`).join("\n") : "No measurements recorded." },
    { kind: "p", text: "Site notes" },
    { kind: "p", text: record.notes || record.firstImpressions || "No site notes recorded." },
  ];
  if (record.linesetsEnabled && record.linesets.length) blocks.push({ kind: "p", text: "Lineset schedule" }, { kind: "p", text: record.linesets.map((row) => `${row.pos} · ${row.type || "—"} · ${row.setName || "Unnamed"} · ${row.cond || "—"} ${row.notes}`.trim()).join("\n") });
  if (record.assessmentEnabled) {
    blocks.push({ kind: "p", text: "Condition & Needs Assessment" }, { kind: "p", text: record.assessment.statedConcern || "No stated concern recorded." });
    const ratings = CONDITION_CATEGORIES.map((category) => `${category.label}: ${record.assessment.conditions[category.key]?.rating || "Not rated"}${record.assessment.conditions[category.key]?.notes ? ` — ${record.assessment.conditions[category.key].notes}` : ""}`);
    blocks.push({ kind: "p", text: ratings.join("\n") });
    if (record.assessment.findings.length) blocks.push({ kind: "p", text: "Findings & recommendations" }, { kind: "p", text: record.assessment.findings.map((finding) => `${finding.bucket || "Unscheduled"}: ${finding.title}${finding.detail ? ` — ${finding.detail}` : ""}`).join("\n") });
  }
  blocks.push({ kind: "p", text: "Sign-off" }, { kind: "p", text: `Peak representative: ${record.signoff.repName || "________________"}  ${record.signoff.repSignedAt || ""}\nSite contact: ${record.signoff.contactName || "________________"}  ${record.signoff.contactSignedAt || ""}${record.signoff.reviewerName ? `\nTechnical reviewer: ${record.signoff.reviewerName}${record.signoff.reviewerRole ? ` (${record.signoff.reviewerRole})` : ""}  ${record.signoff.reviewerSignedAt || ""}` : ""}` });
  return { companyName, accent, tag: "Venue Assessment", tagNote: `Rev. ${record.templateRev}`, meta: [{ label: "Job / Opp #:", value: record.id }, { label: "Date:", value: new Date(record.updatedAt).toLocaleDateString() }, { label: "Venue:", value: record.venue || "—", strong: true }], re: `Venue Assessment — ${record.venue || record.customer}`, greeting: record.contact || "Team", blocks, costLine: "", costTail: "", taxNote: `Venue Assessment Rev. ${record.templateRev}`, signer: { name: record.signoff.repName || "Peak Systems Group", title: "" } };
}

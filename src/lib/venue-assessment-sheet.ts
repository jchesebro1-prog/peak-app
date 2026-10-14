import type { LetterDoc, FieldSheetPage, FieldSheetSection } from "@/lib/pdf";
import type { SurveyRecord } from "@/lib/stores/surveys";
import { VENUE_CLASSES, classMeasureFields } from "@/lib/stores/venue-classes";
import {
  DISCIPLINE_GROUPS,
  visibleFields,
  type DisciplineData,
  type SystemField,
} from "@/lib/stores/survey-intake";
import {
  BUDGET_TIERS,
  CONDITION_CATEGORIES,
  CONDITION_RATINGS,
  EVENT_FREQUENCIES,
  EVENT_TYPES,
  FINDING_BUCKETS,
  STAFF_TIERS,
} from "@/lib/stores/assessment";
import { goalListsFromSurvey } from "@/lib/estimate-output/goals";
import { recapFor, recapScopeText } from "@/lib/survey-flow";
import type { LegacyNote } from "@/lib/survey-migrate";
import { linesetCondLabel, linesetTypeLabel } from "@/lib/stores/linesets";
import { conditionLabel, isConditionLevel } from "@/lib/field-lists";
import {
  accessFacts, consoleLocationText, curtainItemText, curtainItemsOf, monthText, positionRowText, positionRowsOf, scopeText,
} from "@/lib/survey-format";

type SheetRecord = Pick<
  SurveyRecord,
  | "id" | "customer" | "venue" | "venueClass" | "venueSubtype" | "address"
  | "contact" | "contactPhone" | "contactEmail" | "visitPurpose" | "reason"
  | "scheduledDate" | "createdAt" | "assignedTo" | "requestedBy"
  | "measurements" | "disciplines" | "linesetsEnabled" | "linesets"
  | "lifeSafety" | "loadingDoorSize" | "liftHeight" | "pathToFloor"
  | "loadingDoorType" | "loadingDoorLocation" | "loadingDoorWH" | "liftRequired" | "liftType"
  | "liftWorkingHeight" | "liftSupplier" | "liftNeeded"
  | "workingHours" | "blackoutDates" | "floorProtection" | "badgingRequired"
  | "firstImpressions" | "budget" | "fiscalYearSpendBy" | "whoDecides"
  | "targetInstallWindow" | "scopeOfWork" | "quoteLook" | "notes"
  | "assessmentEnabled" | "assessment" | "templateRev" | "signoff"
  | "scope" | "legacyNotes"
>;

const text = (value: unknown): string => {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value ?? "").trim();
};

const row = (label: string, value: unknown) => ({ label, value: text(value) });

function page(title: string, ...sections: FieldSheetSection[]): FieldSheetPage {
  return { title, sections: sections.filter((section) => section.rows.length > 0) };
}

function compactRows(rows: ReturnType<typeof row>[]) {
  return rows.filter((item) => item.value);
}

/** One discipline field as printed: a bound field shows its measurement, a condition its label, a month "Mar 2024",
 *  the console location Other's text; a stored object (never a def's value) prints nothing. */
function fieldText(field: SystemField, data: DisciplineData, measurements: Record<string, string> | undefined): string {
  const raw: unknown = field.bind ? (text(measurements?.[field.bind]) || data[field.key]) : data[field.key];
  if (field.type === "condition") return conditionLabel(raw);
  if (field.type === "month") return monthText(raw);
  if (field.key === "consoleLocation") return consoleLocationText(data);
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return "";
  return text(raw);
}

function disciplineSection(record: SheetRecord, index: number): FieldSheetSection {
  const group = DISCIPLINE_GROUPS[index];
  const data: DisciplineData = record.disciplines?.[group.key] || {};
  const goals = goalListsFromSurvey(record)[group.key] ?? [];
  const extra: ReturnType<typeof row>[] = [];
  if (group.key === "curtain") {
    extra.push(...curtainItemsOf(data).map(({ label, item }) => row(label, curtainItemText(item))));
    extra.push(row("Replace vs. reuse (curtains)", data.replaceVsReuse));
  }
  if (group.key === "lighting") {
    const positions = positionRowsOf(data);
    extra.push(...(positions.length ? positions.map(({ pos, row: r }) => row(pos, positionRowText(r))) : [row("Lighting positions", "")]));
  }
  const rows = [
    row("Client goals", goals.join("; ")),
    row("Present", data.present),
    ...visibleFields(group, record.venueClass).map((field) => row(field.label, fieldText(field, data, record.measurements))),
    ...extra,
    row(group.scopeLabel, scopeText(data)),
    row("Notes", data.notes),
  ];
  return { heading: group.title, rows };
}

/** Build the complete, class-aware worksheet model consumed by renderLetterPdf. */
export function buildAssessmentSheet(record: SheetRecord): LetterDoc {
  const classLabel =
    VENUE_CLASSES.find((item) => item.key === record.venueClass)?.label || "Other";
  const title = `${classLabel} Venue Assessment`;
  /* A migrated record (get() always derives legacyNotes) already moved or noted its old access answers. */
  const access = accessFacts(record, !Array.isArray(record.legacyNotes));
  const pages: FieldSheetPage[] = [
    page(
      title,
      {
        heading: "Customer & venue",
        rows: [
          row("Customer", record.customer), row("Venue", record.venue),
          row("Venue class", classLabel), row("Venue subtype", record.venueSubtype),
          row("Address", record.address), row("Contact", record.contact),
          row("Phone", record.contactPhone), row("Email", record.contactEmail),
        ],
      },
      {
        heading: "Visit brief",
        rows: [
          row("Purpose", record.visitPurpose), row("Reason", record.reason),
          row("Assigned to", record.assignedTo), row("Requested by", record.requestedBy),
        ],
      },
      {
        heading: "What we heard",
        rows: compactRows(
          recapFor(record).flatMap((e) => [row(e.label, recapScopeText(e)), row(`${e.label} goals`, e.goals.join("; "))])
        ),
      }
    ),
    page(
      `${title} — Site & access`,
      {
        heading: "Site access",
        rows: [
          row("Loading door type", access.doorType), row("Loading door location", access.doorLocation),
          row("Loading door W × H", access.doorWH), row("Lift needed", access.liftNeeded),
          row("Lift type", access.liftType), row("Working height", access.liftWorkingHeight),
          row("Who supplies lift", access.liftSupplier),
          row("Path to floor", record.pathToFloor), row("Working hours", record.workingHours),
          row("Blackout dates", record.blackoutDates), row("Floor protection", record.floorProtection),
          row("Badging required", record.badgingRequired), row("First impressions", record.firstImpressions),
        ],
      },
      {
        heading: "Measurements",
        rows: classMeasureFields(record.venueClass).map((field) =>
          row(field.label, record.measurements?.[field.key])
        ),
      }
    ),
    page(`${title} — Systems`, disciplineSection(record, 0), disciplineSection(record, 1)),
    page(`${title} — Systems`, disciplineSection(record, 2), disciplineSection(record, 3)),
  ];

  if (record.linesetsEnabled || (record.linesets?.length ?? 0) > 0) {
    pages.push(page(`${title} — Lineset schedule`, {
      heading: "Linesets",
      rows: (record.linesets || []).map((line) => row(
        `${line.pos || "—"} · ${line.setName || linesetTypeLabel(line.type) || "Lineset"}`,
        [
          line.distFromPL && `PL ${line.distFromPL}`,
          line.battenLength && `batten ${line.battenLength}`,
          line.goods, line.finishedWH,
          (line.trimLow || line.trimHigh) && `trim ${line.trimLow || "—"}/${line.trimHigh || "—"}`,
          isConditionLevel(line.condition) ? conditionLabel(line.condition) : linesetCondLabel(line.cond), line.notes,
        ].filter(Boolean).join(" · ")
      )),
    }));
  }

  const lifeSafety = compactRows([
    row("Deluge / sprinkler", record.lifeSafety?.deluge),
    row("Smoke vent / hatch", record.lifeSafety?.smokeVent),
    row("ADA access", record.lifeSafety?.adaNotes),
    row("Egress", record.lifeSafety?.egressNotes),
  ]);
  pages.push(page(
    `${title} — Project notes`,
    ...(lifeSafety.length ? [{ heading: "Life safety", rows: lifeSafety }] : []),
    {
      heading: "Quote & notes",
      rows: compactRows([
        row("Budget", record.budget), row("Fiscal-year spend-by", record.fiscalYearSpendBy),
        row("Decision maker", record.whoDecides), row("Target install window", record.targetInstallWindow),
        row("Scope of work", record.scopeOfWork), row("Quote should look like", record.quoteLook),
        row("Notes", record.notes),
      ]),
    },
    ...(record.legacyNotes?.length
      ? [{ heading: "Older notes", rows: (record.legacyNotes as LegacyNote[]).map((n) => row(n.label, n.text)) }]
      : [])
  ));

  if (record.assessmentEnabled) {
    const assessment = record.assessment;
    const eventLabels = new Map<string, string>(EVENT_TYPES.map((item) => [item.key, item.label]));
    const frequencyLabels = new Map<string, string>(EVENT_FREQUENCIES.map((item) => [item.key, item.label]));
    const staffLabels = new Map<string, string>(STAFF_TIERS.map((item) => [item.key, item.label]));
    pages.push(page("Assessment — Usage profile", {
      heading: "Usage profile",
      rows: [
        row("Assessment date", assessment?.date), row("Assessors", assessment?.assessors),
        row("Stated concern", assessment?.statedConcern),
        ...(assessment?.usage?.eventTypes || []).map((event) =>
          row(eventLabels.get(event.key) || event.key, frequencyLabels.get(event.frequency) || event.frequency)
        ),
        row("Staffing", staffLabels.get(assessment?.usage?.staffTier || "") || assessment?.usage?.staffTier),
        row("Training gaps", assessment?.usage?.trainingGaps),
        row("Growth goals", assessment?.usage?.growthGoals),
        row("Growth notes", assessment?.usage?.growthNotes),
      ],
    }));

    const ratingLabels = new Map<string, string>(CONDITION_RATINGS.map((item) => [item.key, item.label]));
    pages.push(page("Assessment — Condition ratings", {
      heading: "Condition ratings",
      rows: [
        ...CONDITION_CATEGORIES.map((category) => {
          const condition = assessment?.conditions?.[category.key];
          return row(category.label, [ratingLabels.get(condition?.rating || "") || "Unrated", condition?.notes].filter(Boolean).join(" — "));
        }),
        row("Electrical notes", assessment?.electricalNotes),
      ],
    }));

    const bucketLabels = new Map<string, string>(FINDING_BUCKETS.map((item) => [item.key, item.label]));
    const budgetLabels = new Map<string, string>(BUDGET_TIERS.map((item) => [item.key, item.label]));
    for (const bucket of FINDING_BUCKETS) {
      const findings = (assessment?.findings || []).filter((finding) => finding.bucket === bucket.key);
      if (!findings.length) continue;
      pages.push(page(`Assessment — Findings: ${bucket.label}`, {
        heading: `${bucketLabels.get(bucket.key)} priorities`,
        rows: findings.map((finding) => row(
          finding.title,
          [finding.detail, budgetLabels.get(finding.budgetTier), finding.photoIds.length ? `Photos: ${finding.photoIds.join(", ")}` : ""].filter(Boolean).join(" · ")
        )),
      }));
    }
  }

  const signoffRows = [
    row("Peak representative", [record.signoff?.repName, record.signoff?.repSignedAt].filter(Boolean).join(" — ")),
    row("Customer contact", [record.signoff?.contactName, record.signoff?.contactSignedAt].filter(Boolean).join(" — ")),
  ];
  if (record.signoff?.reviewerName) {
    signoffRows.push(row(
      "Technical reviewer",
      [record.signoff.reviewerName, record.signoff.reviewerRole, record.signoff.reviewerSignedAt].filter(Boolean).join(" — ")
    ));
  }
  const signed = Object.values(record.signoff || {}).some((v) => String(v ?? "").trim() !== "");
  if (signed) pages.push(page(`${title} — Close-out`, { heading: "Sign-off", rows: signoffRows }));

  const date = record.scheduledDate || record.assessment?.date ||
    (record.createdAt ? new Date(record.createdAt).toISOString().slice(0, 10) : "");
  return {
    companyName: "Peak Systems Group",
    accent: "#b08d4a",
    tag: title,
    meta: [], re: "", greeting: "", blocks: [], costLine: "", costTail: "", taxNote: "",
    signer: { name: "", title: "" },
    fieldSheet: {
      job: record.id,
      date,
      footer: `Venue Assessment Rev. ${record.templateRev || "—"}`,
      pages,
    },
  };
}

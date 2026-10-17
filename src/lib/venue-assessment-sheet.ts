import type { LetterDoc, FieldSheetPage, FieldSheetSection, FieldSheetImage } from "@/lib/pdf";
import type { SurveyRecord } from "@/lib/stores/surveys";
import { VENUE_CLASSES, classMeasureFields } from "@/lib/stores/venue-classes";
import {
  DISCIPLINE_GROUPS,
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
import { recapFor, recapScopeText, SECTION_ORDER, sectionVisible, visibleSketchPads, type FlowSlice } from "@/lib/survey-flow";
import { MEASURE_GROUPS } from "@/lib/survey-measure-fields";
import { photoShows, type SketchRef, type SurveyPhotoRef } from "@/lib/field-files/files";
import type { LegacyNote } from "@/lib/survey-migrate";
import { linesetCondLabel, linesetTypeLabel } from "@/lib/stores/linesets";
import { conditionLabel, isConditionLevel } from "@/lib/field-lists";
import {
  accessFacts, consoleLocationText, curtainItemText, curtainItemsOf, monthText, positionRowText, positionRowsOf, presentIsNoneOnly, scopeText, shownFields,
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
  /* A bound field is the measurement only: a cleared measurement stays cleared (the old discipline value never comes back). */
  const raw: unknown = field.bind ? measurements?.[field.bind] : data[field.key];
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
  /* Present = None only: the editor shows just goals, Present and scope (#344 B-final2) */
  if (presentIsNoneOnly(data)) {
    return { heading: group.title, rows: [row("Client goals", goals.join("; ")), row("Present", data.present), row(group.scopeLabel, scopeText(data))] };
  }
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
    /* the fields the editor shows (the pipes qty belongs to its Present chip) */
    ...shownFields(group, data, record.venueClass).map((field) => row(field.label, fieldText(field, data, record.measurements))),
    ...extra,
    row(group.scopeLabel, scopeText(data)),
    row("Notes", data.notes),
  ];
  return { heading: group.title, rows };
}

/* ------------------------------------------------------------------ */
/* images (#344 C7)                                                     */
/* ------------------------------------------------------------------ */

/** The most image bytes one printed sheet embeds; past it the rest are listed as text rows. */
export const SHEET_IMAGE_BUDGET = 20 * 1024 * 1024;
/** How many files the print loads at once. */
export const SHEET_IMAGE_CONCURRENCY = 4;

/** One picture the sheet would print: a section photo (`fileIds` = the markup's image, then the original), a sketch
 *  (its flattened `s_` image; full width, captioned with the pad's title) or an old inline photo (`dataUrl`). */
export type SheetImageItem = {
  id: string;
  kind: "photo" | "sketch" | "earlier";
  /** The editor section it belongs to ("photos" for the old inline Earlier photos). */
  section: string;
  caption?: string;
  full: boolean;
  fileIds: string[];
  dataUrl?: string;
};
export type SheetImageSkip = "unavailable" | "not-jpeg" | "over-budget";
/** A planned image with its JPEG bytes, or why it prints as a text row instead. */
export type ResolvedSheetImage = SheetImageItem & { jpeg?: Buffer; skipped?: SheetImageSkip };

type ImagesRecord = FlowSlice & {
  assessmentEnabled?: boolean;
  linesetQty?: unknown;
  sketches?: Record<string, SketchRef> | null;
  photoRefs?: SurveyPhotoRef[] | null;
  photos?: Array<{ id?: string; name?: string; dataUrl?: string }> | null;
};

const DISC_SECTION: Record<string, string> = { rigging: "dRigging", curtain: "dCurtain", lighting: "dLighting", av: "dAv" };
const ASSESSMENT_ONLY = new Set(["assessmentUsage", "assessmentCondition", "assessmentFindings"]);

/** The editor's section titles (controls.tsx) — a photo's section is named by them on the sheet. */
const SECTION_TITLES: Record<string, string> = {
  cust: "Customer & venue", visit: "Visit", tier1: "Kill questions", site: "Site access & logistics", lifeSafety: "Life safety",
  mQuick: "Measurements", m3d: "3D preview", linesets: "Lineset schedule", assessmentToggle: "Condition & Needs assessment",
  assessmentUsage: "Usage & needs profile", assessmentCondition: "Condition ratings", assessmentFindings: "Findings & recommendations",
  photos: "Earlier photos", notes: "Scope & notes", project: "Existing materials & quote", finalQuestions: "Final questions",
  recap: "Customer recap", finalThoughts: "Final thoughts", assign: "Assignment & schedule",
  ...Object.fromEntries(MEASURE_GROUPS.map((g) => [g.id, g.title])),
  ...Object.fromEntries(DISCIPLINE_GROUPS.map((g) => [DISC_SECTION[g.key], g.title])),
};

/** Whether the editor shows this section's photos (the plain-text / print rule: show what the editor shows). */
function sectionShown(r: ImagesRecord, id: string): boolean {
  if (id === "photos" || !SECTION_ORDER.includes(id)) return false;
  if (ASSESSMENT_ONLY.has(id) && !r.assessmentEnabled) return false;
  return sectionVisible(r, id);
}

/**
 * Which pictures the printed sheet carries, in section order — pure, no bytes. Photos only in sections the editor
 * shows (scope, rigging system, assessment on), the markup's image first; sketches only on pads the editor shows
 * (`visibleSketchPads`: the section's own scope + the pad's gate); the old inline photos as Earlier photos.
 */
export function planSheetImages(r: ImagesRecord): SheetImageItem[] {
  const items: SheetImageItem[] = [];
  const refs = Array.isArray(r.photoRefs) ? r.photoRefs : [];
  const sketches = r.sketches && typeof r.sketches === "object" && !Array.isArray(r.sketches) ? r.sketches : {};
  for (const id of SECTION_ORDER) {
    if (id === "photos") {
      for (const p of Array.isArray(r.photos) ? r.photos : []) {
        if (!p || typeof p.dataUrl !== "string" || !p.dataUrl) continue;
        items.push({ id: `earlier:${p.id ?? items.length}`, kind: "earlier", section: "photos", caption: String(p.name ?? "").trim() || undefined, full: false, fileIds: [], dataUrl: p.dataUrl });
      }
      continue;
    }
    if (!sectionShown(r, id)) continue;
    for (const ref of refs) {
      if (!ref || ref.section !== id) continue;
      const shows = photoShows(ref);
      if (!shows.length) continue;
      items.push({ id: `photo:${ref.id}`, kind: "photo", section: id, caption: String(ref.caption ?? "").trim() || undefined, full: false, fileIds: shows.map((x) => x.fileId) });
    }
    for (const pad of visibleSketchPads(r, id)) {
      const sk = sketches[pad.key];
      if (!sk || typeof sk.id !== "string") continue;
      items.push({ id: `sketch:${pad.key}`, kind: "sketch", section: id, caption: pad.title, full: true, fileIds: [sk.id] });
    }
  }
  return items;
}

const isJpeg = (b: Buffer): boolean => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** An old inline photo's bytes (a base64 data URL), or null. */
function inlineBytes(dataUrl: string): Buffer | null {
  const m = /^data:[^;,]*;base64,([\s\S]*)$/.exec(dataUrl);
  if (!m) return null;
  try {
    const b = Buffer.from(m[1], "base64");
    return b.length ? b : null;
  } catch {
    return null;
  }
}

/**
 * Load the planned pictures' bytes through `load` (the print's `surveyFileBytes`; never throws — a failure or a
 * missing file is `unavailable`), at most `concurrency` at once. A photo tries its markup, then the original; only
 * JPEGs embed (anything else is `not-jpeg`). The embedded bytes share `budget` in plan order — past it, every later
 * picture is `over-budget` (and isn't loaded once the budget is known to be spent).
 */
export async function resolveSheetImages(
  plan: SheetImageItem[],
  load: (fileId: string) => Promise<Buffer | null>,
  opts: { budget?: number; concurrency?: number } = {},
): Promise<ResolvedSheetImage[]> {
  const budget = opts.budget ?? SHEET_IMAGE_BUDGET;
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? SHEET_IMAGE_CONCURRENCY));
  /* undefined = never loaded (budget spent), null = unavailable */
  const got: Array<Buffer | "not-jpeg" | null | undefined> = new Array(plan.length);
  const one = async (it: SheetImageItem): Promise<Buffer | "not-jpeg" | null> => {
    if (it.dataUrl !== undefined) {
      const b = inlineBytes(it.dataUrl);
      return !b ? null : isJpeg(b) ? b : "not-jpeg";
    }
    let other = false;
    for (const fileId of it.fileIds) {
      let b: Buffer | null = null;
      try {
        b = await load(fileId);
      } catch {
        b = null;
      }
      if (!b || !b.length) continue;
      if (isJpeg(b)) return b;
      other = true;
    }
    return other ? "not-jpeg" : null;
  };
  let loaded = 0;
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= plan.length) return;
      if (loaded > budget) continue; // indices are claimed in order: everything before this already spent the budget
      const r = await one(plan[i]);
      got[i] = r;
      if (Buffer.isBuffer(r)) loaded += r.length;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, plan.length) }, worker));
  let used = 0;
  let over = false;
  return plan.map((it, i): ResolvedSheetImage => {
    const r = got[i];
    if (r === "not-jpeg") return { ...it, skipped: "not-jpeg" };
    if (r === null) return { ...it, skipped: "unavailable" };
    if (r === undefined || over || used + r.length > budget) {
      over = true;
      return { ...it, skipped: "over-budget" };
    }
    used += r.length;
    return { ...it, jpeg: r };
  });
}

const SKIP_TEXT: Record<SheetImageSkip, string> = {
  unavailable: "not available (not uploaded yet, or missing)",
  "not-jpeg": "not printed (not a JPEG)",
  "over-budget": "not printed (the sheet's image limit was reached)",
};

/** Put each section's pictures on the sheet page that prints that section: embedded ones as image blocks, skipped
 *  ones as text rows. Sections with no page of their own (and Earlier photos) land on Project notes. */
function attachSheetImages(pages: FieldSheetPage[], title: string, images: ResolvedSheetImage[]): void {
  const find = (t: string) => pages.findIndex((p) => p.title === t);
  const notes = find(`${title} — Project notes`);
  const or = (...idx: number[]) => idx.find((i) => i >= 0) ?? notes;
  const findings = pages.map((p) => p.title.startsWith("Assessment — Findings:")).lastIndexOf(true);
  const pageFor = (section: string): number => {
    if (["cust", "visit", "tier1", "assign", "recap"].includes(section)) return 0;
    if (["site", "mQuick", "m3d", ...MEASURE_GROUPS.map((g) => g.id)].includes(section)) return 1;
    const d = DISCIPLINE_GROUPS.findIndex((g) => DISC_SECTION[g.key] === section);
    if (d >= 0) return 2 + Math.floor(d / 2);
    if (section === "linesets") return or(find(`${title} — Lineset schedule`));
    if (section === "assessmentToggle" || section === "assessmentUsage") return or(find("Assessment — Usage profile"));
    if (section === "assessmentCondition") return or(find("Assessment — Condition ratings"));
    if (section === "assessmentFindings") return or(findings, find("Assessment — Condition ratings"));
    return notes;
  };
  const bySection = new Map<string, ResolvedSheetImage[]>();
  for (const it of images) bySection.set(it.section, [...(bySection.get(it.section) ?? []), it]);
  for (const [section, items] of bySection) {
    const sectionTitle = SECTION_TITLES[section] ?? section;
    const photos = items.some((x) => x.kind !== "sketch");
    const sketches = items.some((x) => x.kind === "sketch");
    const heading = section === "photos" ? "Earlier photos" : `${sectionTitle} — ${photos && sketches ? "photos & sketches" : sketches ? "sketches" : "photos"}`;
    const rows = items
      .filter((x) => !x.jpeg)
      .map((x) => row(x.kind === "sketch" ? "Sketch" : "Photo", `${x.caption || sectionTitle} — ${SKIP_TEXT[x.skipped ?? "unavailable"]}`));
    const embedded: FieldSheetImage[] = items.filter((x) => x.jpeg).map((x) => ({ jpeg: x.jpeg!, caption: x.caption, full: x.full }));
    const target = pages[pageFor(section)] ?? pages[pages.length - 1];
    target.sections.push({ heading, rows, ...(embedded.length ? { images: embedded } : {}) });
  }
}

/** Build the complete, class-aware worksheet model consumed by renderLetterPdf. `images` (#344 C7) are the pictures
 *  `resolveSheetImages` loaded for `planSheetImages(record)`; without them the sheet is text only, as before. */
export function buildAssessmentSheet(record: SheetRecord, images?: ResolvedSheetImage[]): LetterDoc {
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
          /* Lift needed No: the details don't apply (a value kept from before stays stored, not printed) */
          ...(access.liftNeeded === "No"
            ? []
            : [row("Lift type", access.liftType), row("Working height", access.liftWorkingHeight), row("Who supplies lift", access.liftSupplier)]),
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
          isConditionLevel(line.condition) ? conditionLabel(line.condition) : line.condition === undefined ? linesetCondLabel(line.cond) : "", line.notes,
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
  if (images?.length) attachSheetImages(pages, title, images);

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

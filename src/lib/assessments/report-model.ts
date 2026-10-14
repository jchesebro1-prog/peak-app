/* Assessments engine (#340, Task 10) — the report's pure data shaping. The assessment report (spec §4: seven sections,
   in the sample rigging reports' order) and the findings-only report are both built here from plain inputs, so the
   harness can pin section order, answer wording, the follow-up list and the register sort. No db / next / React
   imports, no clock (time comes in as `now`). The loaders live in report-data.ts; the markup in
   src/components/assessments/. */
import type { Answer, Answers } from "./answers";
import type { AssessmentDef, Category, QuestionDef, Rating, ScopeCode } from "./defs/types";
import { allModules, allQuestions } from "./defs";
import { evaluate, type EvalResult, type ScopeSel } from "./evaluate";
import { answerHasContent, flagsForScope, formatValue, optionsFor, photosForQuestions, type PicklistExtrasVM } from "./editor-model";
import { CATEGORY_ROUTING, liveMergeTarget, resolvedPromptIds, type Finding } from "./findings-model";
import { CATEGORIES, PRIORITY_LABEL, RATINGS, RATING_LABEL, STATUS_LABEL, buildingAndSpace, compareRegister, dayLabel, findingLabel } from "./register";
export { findingsPdfHref, parseFindingsScope, type FindingsScope } from "./register";
import type { PhotoRef } from "./photos";

/* ---------- sections ---------- */

/** The seven sections, in order (spec §4). Section 4 holds one sub-section per scope that was run. */
export const REPORT_SECTIONS = [
  { id: "intake", title: "Facility and visit" },
  { id: "scope", title: "Scope and exclusions" },
  { id: "summary", title: "Summary" },
  { id: "scopes", title: "Observations by scope" },
  { id: "register", title: "Findings register" },
  { id: "followup", title: "Follow-up" },
  { id: "photos", title: "Photo appendix" },
] as const;
export type ReportSectionId = (typeof REPORT_SECTIONS)[number]["id"];

/** Section 2's standing line, verbatim. */
export const STANDING_LINE = "Structure and building electrical are flagged for an engineer or electrician and are not rated (ANSI E1.47 excludes them).";

/** The PDF render waits while this matches: the report root before the print page's ReportReady island marks it
 *  (renderPrintRouteToPdf's `waitFor` waits for its selector to STOP matching). */
export const REPORT_WAIT_FOR = "[data-assessment-report]:not([data-report-ready])";

export const PHOTO_UNAVAILABLE = "Photo unavailable";
export const PHOTOS_OVER_CAP_NOTE = "Some photos are too large to include together in this PDF. They show as placeholders here; open the report in Quartzite to see them.";

/* ---------- answers as report text ---------- */

/** A contact as "Name, Title · phone · email" (missing parts dropped). */
export function contactText(v: unknown): string {
  if (!v || typeof v !== "object") return typeof v === "string" ? v : "";
  const c = v as { name?: unknown; title?: unknown; phone?: unknown; email?: unknown };
  const s = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  const head = [s(c.name), s(c.title)].filter(Boolean).join(", ");
  return [head, s(c.phone), s(c.email)].filter(Boolean).join(" · ");
}

/**
 * One answer as the report prints it, or null when it prints nothing (no answer, or a cleared one — `v: null`, state
 * answered). "N/A" for not applicable, "Unable to inspect — <reason>" for unable; contacts as "Name, Title · phone ·
 * email"; pick values by their labels (the definition's plus admin extras, via the editor's own lookups). Tables are
 * not text — see reportTable.
 */
export function reportAnswerText(q: QuestionDef | undefined, a: Answer | undefined, def: AssessmentDef, extras: PicklistExtrasVM): string | null {
  if (!answerHasContent(a)) return null;
  if (a!.state === "na") return "N/A";
  if (a!.state === "unable") return `Unable to inspect — ${(a!.reason ?? "").trim()}`.trim().replace(/ —$/, "");
  if (q?.type === "contact") return contactText(a!.v) || null;
  return formatValue(q, a!.v, def, extras);
}

/** A table answer's header and rows of text cells (pick cells by label, feet-inches, numbers). */
export function reportTable(q: QuestionDef, v: unknown, def: AssessmentDef, extras: PicklistExtrasVM): { columns: string[]; rows: string[][] } {
  const cols = q.columns ?? [];
  const rows = Array.isArray(v) ? v : [];
  return {
    columns: cols.map((c) => c.label),
    rows: rows.map((r) => cols.map((c) => {
      const cell = r && typeof r === "object" ? (r as Record<string, unknown>)[c.key] : undefined;
      if (cell === undefined || cell === null || cell === "") return "";
      return formatValue({ key: c.key, label: c.label, type: c.type, options: c.options }, cell, def, extras);
    })),
  };
}

/* ---------- report model ---------- */

export interface ReportRow {
  key: string;
  label: string;
  /** "text" rows print `text`; "table" rows print `table` (or `text` when the answer is N/A / Unable) */
  kind: "text" | "table";
  text?: string;
  table?: { columns: string[]; rows: string[][] };
  photoIds: string[];
}

export interface ReportModule { id: string; title: string; rows: ReportRow[]; photoIds: string[] }
export interface ReportScope { code: ScopeCode; title: string; depth?: string; flags: string[]; modules: ReportModule[] }

export interface ReportFinding {
  key: string;
  label: string;
  category: Category;
  rating: Rating;
  ratingLabel: string;
  description: string;
  where: string;
  recommendedAction: string;
  priority: string;
  status: string;
  photoIds: string[];
  /** Immediate attention only: the hazard-contact and lockout lines */
  immediate?: { notified: string; lockout: string };
}

export interface ReportPhoto { id: string; n: number; caption: string; pending: boolean }

export interface FollowUp {
  unable: { label: string; reason: string }[];
  /** gaps recorded when the assessment was marked complete over them; `addressedBy` when a finding resolved one later */
  gaps: { text: string; addressedBy?: string }[];
  documents: string[];
}

export interface AssessmentReportModel {
  id: string;
  title: string;
  facility: string;
  venue: string;
  intake: { label: string; value: string; multiline?: boolean }[];
  scopesRun: { title: string; depth?: string }[];
  standingLine: string;
  notAccessible: string | null;
  summary: {
    categories: { code: Category; label: string }[];
    rows: { rating: Rating; label: string; counts: number[]; total: number }[];
    total: number;
    immediate: ReportFinding[];
  };
  scopes: ReportScope[];
  register: ReportFinding[];
  followUp: FollowUp;
  photos: ReportPhoto[];
}

export interface ReportInput {
  assessment: {
    id: string; defVersion: number; visitType: string; scopes: ScopeSel[]; answers: Answers; photos: PhotoRef[];
    dismissedPrompts: { id: string }[]; overriddenGaps?: string[]; visitDate: number; spaceLabel?: string; accompanying?: string;
  };
  def: AssessmentDef;
  extras: PicklistExtrasVM;
  profile: Record<string, unknown>;
  /** every finding raised at this assessment, voided ones included (merges are followed through them) */
  findings: Finding[];
  names: { customer: string; venue: string; address: string; assessor: string };
  now: number;
}

const DEPTH_LABEL: Record<string, string> = { screen: "Screening", full: "Full" };
const LOCKOUT_LABEL: Record<string, string> = { locked: "Locked out", tagged: "Tagged", none: "Not locked out or tagged" };

/** "Mar 3, 2026" for an epoch-ms date answer / visit date (they are stored as UTC midnight). */
export function reportDate(ms: number | undefined | null): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

/** Follows a merged-away finding to the live keeper it now lives in; the finding itself when live; null when the
 *  chain ends at a voided finding, a missing one, or a cycle. */
export function liveKeeper(f: Finding, byKey: Map<string, Finding>): Finding | null {
  return liveMergeTarget(byKey, f);
}

/** The register's rows: live findings only (voided never; merged ones only through their keeper), Immediate → Needs →
 *  Good, then priority (the register's own sort). */
export function reportRegisterFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => !f.voided).sort(compareRegister);
}

function reportFinding(f: Finding, siteName: string): ReportFinding {
  const out: ReportFinding = {
    key: f.key, label: findingLabel(f), category: f.category, rating: f.rating, ratingLabel: RATING_LABEL[f.rating],
    description: f.description ?? "", where: buildingAndSpace(f, siteName), recommendedAction: f.recommendedAction ?? "",
    priority: f.priority ? PRIORITY_LABEL[f.priority] : "", status: STATUS_LABEL[f.status] ?? f.status, photoIds: [...f.photoIds],
  };
  if (f.rating === "immediate") {
    const im = f.immediate;
    out.immediate = {
      notified: !im ? "Not recorded" : im.hazardContactNotified ? `Yes${typeof im.notifiedAt === "number" ? `, ${new Date(im.notifiedAt).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}` : "No",
      lockout: im ? LOCKOUT_LABEL[im.lockout] ?? "Not recorded" : "Not recorded",
    };
  }
  return out;
}

/**
 * Overridden gaps with any later resolution: a "Prompt: <text>" gap whose prompt a finding has since turned into a
 * finding (a late offline finding, synced after Mark complete) reads `addressedBy` <that finding's printed id> — the
 * keeper's, when the finding was merged — instead of standing as an open gap. Prompts are matched by their text (the
 * gap list stores text), against the definition's rule prompts and flagged-answer prompts.
 */
export function followUpGaps(gaps: string[] | undefined, def: AssessmentDef, findings: Finding[]): FollowUp["gaps"] {
  const byKey = new Map(findings.map((f) => [f.key, f]));
  const textToIds = new Map<string, string[]>();
  const add = (text: string, id: string) => textToIds.set(text, [...(textToIds.get(text) ?? []), id]);
  for (const r of def.rules) if (r.prompt) add(r.prompt.text, `rule:${r.id}`);
  for (const { q } of allQuestions(def).values()) if (q.flag) add(q.flag.text, `flag:${q.key}`);
  return (gaps ?? []).map((g) => {
    if (!g.startsWith("Prompt: ")) return { text: g };
    const ids = textToIds.get(g.slice(8)) ?? [];
    for (const f of findings) {
      // What this finding resolves on its own (as if live), then whether its merge chain still ends at a live finding.
      const own = resolvedPromptIds([{ key: f.key, ruleId: f.ruleId, questionKeys: f.questionKeys }]);
      if (!own.some((id) => ids.includes(id))) continue;
      const keeper = liveKeeper(f, byKey);
      if (keeper) return { text: g, addressedBy: findingLabel(keeper) };
    }
    return { text: g };
  });
}

/** Documents to request: each document listed as available (never "None") that the detail table doesn't mark received. */
export function documentsToRequest(answers: Answers, def: AssessmentDef, extras: PicklistExtrasVM): string[] {
  const avail = answers["core.docs_available"];
  if (!avail || avail.state !== "answered" || !Array.isArray(avail.v)) return [];
  const detail = answers["core.docs_detail"];
  const rows = detail?.state === "answered" && Array.isArray(detail.v) ? (detail.v as Record<string, unknown>[]) : [];
  const label = (list: string, v: unknown) => optionsFor(def, extras, list, v).find((o) => o.value === v)?.label ?? String(v);
  const out: string[] = [];
  for (const d of avail.v as unknown[]) {
    if (typeof d !== "string" || d === "none") continue;
    const row = rows.find((r) => r && r.doc === d);
    if (row?.status === "received") continue;
    const bits = [row?.format ? label("doc_format", row.format).toLowerCase() : "", row?.status === "to_follow" ? "to follow" : ""].filter(Boolean);
    out.push(label("docs", d) + (bits.length ? ` (${bits.join(", ")})` : ""));
  }
  return out;
}

/** Builds the seven-section assessment report. */
export function buildAssessmentReport(input: ReportInput): AssessmentReportModel {
  const { assessment: a, def, extras, findings, names } = input;
  const questions = allQuestions(def);
  const modules = allModules(def);
  const res: EvalResult = evaluate({
    def, visitType: a.visitType, scopes: a.scopes, answers: a.answers, profile: input.profile, photos: a.photos,
    dismissed: a.dismissedPrompts.map((d) => d.id), resolved: resolvedPromptIds(findings), now: input.now,
  });
  const ans = (k: string): Answer | undefined => (Object.hasOwn(a.answers, k) && res.visible.has(k) ? a.answers[k] : undefined);
  const text = (k: string) => reportAnswerText(questions.get(k)?.q, ans(k), def, extras);

  // 1. Facility and visit
  const intake: AssessmentReportModel["intake"] = [];
  const push = (label: string, value: string | null | undefined, multiline?: boolean) => {
    if (value && value.trim()) intake.push(multiline ? { label, value, multiline } : { label, value });
  };
  push("Facility", names.customer);
  push("Building and space", [names.venue, a.spaceLabel].filter(Boolean).join(" · "));
  push("Address", names.address);
  push("Visit date", reportDate(a.visitDate));
  push("Assessor", names.assessor);
  push("Accompanied by", a.accompanying);
  push("Primary contact", text("core.contact_primary"));
  push("Secondary contact", text("core.contact_secondary"));
  push("Hazard contact", text("core.contact_hazard"));
  push("Owner concerns", text("core.owner_concerns"), true);
  push("Use", text("core.use"));
  push("Space type", text("core.space_type"));
  push("Seats", text("core.seats"));
  const insp = ["core.last_inspection_date", "core.last_inspection_firm", "core.last_inspection_level"].map(text).filter((x): x is string => !!x);
  const report = ans("core.last_inspection_report");
  if (report?.state === "answered" && (report.v === "yes" || report.v === "no")) insp.push(report.v === "yes" ? "report on file" : "no report on file");
  push("Last rigging inspection", insp.join(" · "));

  // 2. Scope and exclusions
  const scopesRun = def.scopes
    .filter((s) => s.code === "S0" || a.scopes.find((x) => x.code === s.code)?.on)
    .map((s) => {
      const sel = a.scopes.find((x) => x.code === s.code);
      return sel?.depth ? { title: s.title, depth: DEPTH_LABEL[sel.depth] ?? sel.depth } : { title: s.title };
    });

  // 5. Findings register (and 3's counts) — live findings only.
  const live = reportRegisterFindings(findings);
  const register = live.map((f) => reportFinding(f, names.venue));
  const cats = CATEGORIES.map((code) => ({ code, label: CATEGORY_ROUTING[code].label }));
  const rows = RATINGS.map((r) => {
    const counts = CATEGORIES.map((c) => live.filter((f) => f.rating === r && f.category === c).length);
    return { rating: r, label: RATING_LABEL[r], counts, total: counts.reduce((s, n) => s + n, 0) };
  });

  // 4. One section per scope
  const answerPhotos = new Set<string>();
  const scopes: ReportScope[] = [];
  for (const s of def.scopes) {
    const on = s.code === "S0" || a.scopes.find((x) => x.code === s.code)?.on;
    if (!on) continue;
    const sel = a.scopes.find((x) => x.code === s.code);
    const mods: ReportModule[] = [];
    for (const m of s.modules) {
      if (!res.visibleModules.has(m.id)) continue;
      const mrows: ReportRow[] = [];
      for (const q of m.questions) {
        if (!res.visible.has(q.key)) continue;
        const answer = ans(q.key);
        // Photos taken on the question or listed on its answer (the editor's own rule). A photo alone still prints the row.
        const pids = photosForQuestions(a, [q.key]);
        if (!answerHasContent(answer) && !pids.length) continue;
        pids.forEach((p) => answerPhotos.add(p));
        if (q.type === "table" && answer?.state === "answered") mrows.push({ key: q.key, label: q.label, kind: "table", table: reportTable(q, answer.v, def, extras), photoIds: pids });
        else mrows.push({ key: q.key, label: q.label, kind: "text", text: reportAnswerText(q, answer, def, extras) ?? "", photoIds: pids });
      }
      mods.push({ id: m.id, title: m.title, rows: mrows, photoIds: [] });
    }
    // Photos taken against a module (a named photo slot) rather than an answer print under that module.
    for (const p of a.photos) {
      if (answerPhotos.has(p.id) || p.questionKey || !p.moduleId) continue;
      const mod = mods.find((x) => x.id === p.moduleId);
      if (mod) mod.photoIds.push(p.id);
    }
    const kept = mods.filter((x) => x.rows.length || x.photoIds.length);
    scopes.push({ code: s.code, title: s.title, ...(sel?.depth ? { depth: DEPTH_LABEL[sel.depth] ?? sel.depth } : {}), flags: flagsForScope(def, res, s.code).map((f) => f.text), modules: kept });
  }

  // 6. Follow-up
  const followUp: FollowUp = {
    unable: res.unable.map((u) => ({ label: questions.get(u.key)?.q.label ?? u.key, reason: u.reason })),
    gaps: followUpGaps(a.overriddenGaps, def, findings),
    documents: documentsToRequest(Object.fromEntries(["core.docs_available", "core.docs_detail"].flatMap((k) => (ans(k) ? [[k, ans(k)!]] : []))), def, extras),
  };

  // 7. Photo appendix — every photo, captioned with its finding ids and question.
  const byKey = new Map(findings.map((f) => [f.key, f]));
  const labelsFor = (pid: string, findingKey: string | undefined): string[] => {
    const out: string[] = [];
    const addF = (f: Finding | undefined) => {
      const k = f ? liveKeeper(f, byKey) : null;
      if (k && !out.includes(findingLabel(k))) out.push(findingLabel(k));
    };
    if (findingKey) addF(byKey.get(findingKey));
    for (const f of live) if (f.photoIds.includes(pid)) addF(f);
    return out;
  };
  const questionFor = (p: PhotoRef): string => {
    if (p.questionKey) return questions.get(p.questionKey)?.q.label ?? p.questionKey;
    for (const [k, ansr] of Object.entries(a.answers)) if (ansr.photoIds?.includes(p.id)) return questions.get(k)?.q.label ?? k;
    const mod = p.moduleId ? modules.get(p.moduleId)?.m : undefined;
    const req = p.reqId && mod?.photos?.find((r) => r.id === p.reqId);
    if (req) return req.label;
    return mod?.title ?? "";
  };
  const photos: ReportPhoto[] = a.photos.map((p, i) => {
    const caption = [...labelsFor(p.id, typeof p.findingKey === "string" ? p.findingKey : undefined), questionFor(p), p.caption ?? ""].filter((x) => x && x.trim()).join(" · ");
    return { id: p.id, n: i + 1, caption: caption || `Photo ${i + 1}`, pending: !!p.pending };
  });

  return {
    id: a.id,
    title: `Venue assessment — ${names.venue}`,
    facility: names.customer,
    venue: names.venue,
    intake,
    scopesRun,
    standingLine: STANDING_LINE,
    notAccessible: text("core.not_accessible"),
    summary: { categories: cats, rows, total: live.length, immediate: register.filter((f) => f.rating === "immediate") },
    scopes,
    register,
    followUp,
    photos,
  };
}

/* ---------- findings-only report ---------- */

/** The open findings for the findings-only report: not voided, not closed, register sort. */
export function openFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => !f.voided && f.status !== "closed").sort(compareRegister);
}

export interface FindingsReportModel {
  title: string;
  subject: string;
  /** Chicago day, YYYY-MM-DD */
  date: string;
  dateLong: string;
  rows: (ReportFinding & { assessmentId: string })[];
  counts: { rating: Rating; label: string; n: number }[];
}

export function buildFindingsReport(input: { findings: Finding[]; subject: string; siteNames: Record<string, string>; now: number }): FindingsReportModel {
  const open = openFindings(input.findings);
  return {
    title: "Open findings",
    subject: input.subject,
    date: dayLabel(input.now),
    dateLong: new Date(input.now).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" }),
    rows: open.map((f) => ({ ...reportFinding(f, input.siteNames[f.siteId] ?? f.siteId), assessmentId: f.assessmentId })),
    counts: RATINGS.map((r) => ({ rating: r, label: RATING_LABEL[r], n: open.filter((f) => f.rating === r).length })),
  };
}

/* ---------- file names ---------- */

/** Safe inside a file name: path / reserved characters and control characters dropped, spaces collapsed, ≤ 80. */
export function fileNamePart(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim();
}

/** "Assessment AS-1001 — Lincoln HS.pdf" */
export function assessmentPdfName(id: string, venue: string): string {
  const v = fileNamePart(venue);
  return `Assessment ${fileNamePart(id)}${v ? ` — ${v}` : ""}.pdf`;
}

/** "Findings — Lincoln HS — 2026-10-13.pdf" (Chicago day) */
export function findingsPdfName(subject: string, now: number): string {
  const s = fileNamePart(subject);
  return `Findings${s ? ` — ${s}` : ""} — ${dayLabel(now)}.pdf`;
}

/* ---------- photo inlining (print route) ---------- */

export const INLINE_CONCURRENCY = 4;
export const INLINE_TOTAL_BYTES = 20 * 1024 * 1024;
/** Past this the PDF is a download only (a Gmail message carries it base64-encoded). */
export const EMAIL_PDF_MAX_BYTES = 10 * 1024 * 1024;
export const EMAIL_TOO_LARGE = "Report is too large to email — download it instead";
/** Without Blob (local dev) the PDF rides inline in the thread doc as a data URL, so it is kept small. */
export const EMAIL_INLINE_MAX_BYTES = 1.5 * 1024 * 1024;
export const EMAIL_TOO_LARGE_LOCAL = "Report is too large to email from this computer — download it instead";

/**
 * How Email report attaches a rendered PDF of `size` bytes (#340 final review I2): with Blob configured it is stored
 * and attached BY REFERENCE (never base64 in the comms doc), up to 10 MB; without Blob it rides inline as a data URL,
 * up to 1.5 MB. Anything larger is refused with the matching message.
 */
export function emailAttachmentMode(size: number, blobOn: boolean): { mode: "reference" } | { mode: "inline" } | { mode: "refuse"; error: string } {
  if (blobOn) return size > EMAIL_PDF_MAX_BYTES ? { mode: "refuse", error: EMAIL_TOO_LARGE } : { mode: "reference" };
  return size > EMAIL_INLINE_MAX_BYTES ? { mode: "refuse", error: EMAIL_TOO_LARGE_LOCAL } : { mode: "inline" };
}

/**
 * Photos as data URIs for the print route, at most `concurrency` reads at a time. Pending photos are skipped, a read
 * that fails or returns nothing is skipped, and once the next photo would take the total past `maxBytes` it and every
 * later photo are skipped too (`overCap`). Skipped photos are null (they print "Photo unavailable"). Order is the
 * photos' own order, so which photos make the cut never depends on read timing.
 */
export async function inlinePhotoSources(
  photos: Pick<PhotoRef, "id" | "pending">[],
  read: (id: string) => Promise<{ bytes: Uint8Array; contentType: string } | null>,
  opts: { concurrency?: number; maxBytes?: number } = {},
): Promise<{ sources: Record<string, string | null>; overCap: boolean; inlinedBytes: number }> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? INLINE_CONCURRENCY, INLINE_CONCURRENCY));
  const maxBytes = opts.maxBytes ?? INLINE_TOTAL_BYTES;
  const sources: Record<string, string | null> = {};
  let total = 0;
  let overCap = false;
  const todo = photos.filter((p) => {
    sources[p.id] = null;
    return !p.pending;
  });
  for (let i = 0; i < todo.length && !overCap; i += concurrency) {
    const batch = todo.slice(i, i + concurrency);
    const got = await Promise.all(batch.map((p) => read(p.id).catch(() => null)));
    for (let j = 0; j < batch.length; j++) {
      const r = got[j];
      if (!r) continue;
      if (total + r.bytes.byteLength > maxBytes) {
        overCap = true;
        break;
      }
      total += r.bytes.byteLength;
      sources[batch[j].id] = `data:${r.contentType};base64,${Buffer.from(r.bytes).toString("base64")}`;
    }
  }
  return { sources, overCap, inlinedBytes: total };
}

/* ---------- Email report ---------- */

/** The Email report draft's subject and body (plain, deterministic — no AI, D89). */
export function reportEmailCopy(p: { id: string; venue: string; customer: string; visitDate: number; contactName?: string; senderName: string }): { subject: string; body: string } {
  const date = reportDate(p.visitDate);
  const greeting = p.contactName?.trim() ? `Hello ${p.contactName.trim().split(/\s+/)[0]},` : "Hello,";
  return {
    subject: `Venue assessment report — ${p.venue} (${p.id})`,
    body: [
      greeting,
      "",
      `Attached is the venue assessment report for ${p.venue}${date ? ` from our visit on ${date}` : ""}. It lists what we observed, the findings by rating, and the follow-up items we still need from you.`,
      "",
      "Let me know if you have any questions.",
      "",
      p.senderName,
    ].join("\n"),
  };
}

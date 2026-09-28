"use server";

import { revalidatePath } from "next/cache";
import { requirePerm, requireUser, type SessionUser } from "@/lib/session";
import { getManyAnyCase } from "@/lib/stores/catalog";
import { allArticles } from "@/lib/stores/spec-articles";
import { allSections } from "@/lib/stores/spec-sections";
import {
  allSpecRecords,
  getSpecRecord,
  nextSpecId,
  restoreSpecRecordRevision,
  saveSpecRecord,
  specRecordRevisions,
  type SaveOutcome,
} from "@/lib/stores/spec-records";
import { allSpecDocuments, getSpecDocument, patchSpecDocument, type SpecDocument } from "@/lib/stores/spec-documents";
import {
  SPEC_OVERRIDE_TEXT_MAX,
  SPEC_OVERRIDE_TITLE_MAX,
  SPEC_FILL_IN_MAX,
  withLibraryRow,
  withOverride,
  withRowPin,
  withRowSpecKey,
  withWaive,
  withoutOverride,
  withoutWaive,
} from "@/lib/specs/spec-document";
import { isPlaceholderSku, normPartNumber, specRowKey } from "@/lib/specs/record-keys";
import {
  isValidSpecId,
  matchKeyConflict,
  normalizeSpecRecord,
  partNumberConflict,
  validateSpecRecord,
  type RecordProblem,
  type SpecKind,
  type SpecRecord,
} from "@/lib/specs/records";
import { csiKey } from "@/lib/specs/articles";
import { commitSpecRecordImport, planSpecRecordImportFile } from "@/lib/specs/record-io";
import { checkSpecRecordImportFile, type ImportPlan } from "@/lib/specs/record-import";

/**
 * Server actions for the Spec Library records (spec records design §5,
 * Task 8) — link a BOM row to an existing record, write a new one, waive
 * an unresolved row, approve a draft, edit a matched row (project-only or
 * the library), and the Spec Library screen's own record edits. Names are
 * record-specific to avoid colliding with the builder's own
 * `design/specs/builder-actions.ts` and the library's section/article
 * `design/specs/actions.ts`.
 */

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

/** A `why` cap, refused rather than silently cut, like the builder's own
 *  `headerTooLong` (design §5, gates: "title ≤ 300, specText ≤ 20000,
 *  reason ≤ 500, why ≤ 300, ≤ 100 part numbers"). */
const WHY_MAX = 300;
const REASON_MAX = SPEC_FILL_IN_MAX; // 500 — same cap withWaive's reason uses.
const MFR_NUMBERS_MAX = 100;

function tooLong(value: string, max: number, label: string): { ok: false; error: string } | null {
  return value.length > max ? { ok: false, error: `Keep ${label} under ${max} characters.` } : null;
}

/** Every write revalidates the builder route list, the one doc (when there
 *  is one) and the Spec Library screen — records are read live, so a
 *  library-only edit can change what any open spec shows (design §5). */
function revalidateAll(docId?: string) {
  revalidatePath("/design/specs");
  if (docId) revalidatePath(`/design/specs/${docId}`);
  revalidatePath("/design/specs/library");
}

/** Shared tail of every row-level (SpecDocument) mutation: patch, "not
 *  found", revalidate — mirrors builder-actions.ts's own `applyPatch`,
 *  reimplemented locally (not imported) so this file revalidates the
 *  library route too. */
async function applyPatch(id: string, user: SessionUser, mutate: (d: SpecDocument) => SpecDocument): Promise<Result> {
  const patched = await patchSpecDocument(id, mutate, user.name);
  if (!patched) return { ok: false, error: "Spec not found." };
  revalidateAll(id);
  return { ok: true };
}

function rowOnDoc(doc: SpecDocument, rowKey: string): SpecDocument["products"][number] | undefined {
  return doc.products.find((p) => specRowKey(p) === rowKey);
}

const ROW_GONE = "That row is no longer on this spec.";

/** Live validation context, plus the raw record list so a caller can also
 *  run the conflict guards below without a second `allSpecRecords()` fetch. */
async function recordCtx(): Promise<{
  sections: Array<{ id: string; number: string }>;
  articles: Array<{ id: string; sectionId: string }>;
  specIds: Set<string>;
  records: SpecRecord[];
}> {
  const [sections, articles, records] = await Promise.all([allSections(), allArticles(), allSpecRecords()]);
  return {
    sections: sections.map((s) => ({ id: s.id, number: s.number })),
    articles: articles.map((a) => ({ id: a.id, sectionId: a.sectionId })),
    specIds: new Set(records.map((r) => r.specId)),
    records,
  };
}

/** The part number `linkRowToRecordAction`/import would add for a row (spec
 *  records design §5.1 resolution): the row's own `mfrNumber`; failing
 *  that, the catalog part's `manufacturerPartNumber` looked up by the row's
 *  real (non-placeholder) sku; failing that, a real sku itself — the part
 *  after its first `:` when it has one, else the sku as written. `null`
 *  when the row carries no part-number information at all. */
async function partNumberForRow(row: { sku?: string; mfrNumber?: string }): Promise<string | null> {
  if (row.mfrNumber) return row.mfrNumber;
  const sku = row.sku || "";
  if (!sku || isPlaceholderSku(sku)) return null;
  const [part] = await getManyAnyCase([sku]);
  if (part?.manufacturerPartNumber) return part.manufacturerPartNumber;
  const ci = sku.indexOf(":");
  return ci >= 0 ? sku.slice(ci + 1) : sku;
}

/** Runs both cross-record guards (`partNumberConflict`/`matchKeyConflict`,
 *  `src/lib/specs/records.ts`) against `candidate` and returns the first
 *  refusal, or `null` when neither fires. Shared by every write that saves
 *  a record with a `ready` status: write-new, the library editor, approve,
 *  and restore (fix round 1 — approve/restore used to skip these). */
function conflictError(candidate: SpecRecord, all: readonly SpecRecord[]): string | null {
  const mfrConflict = partNumberConflict(candidate, all);
  if (mfrConflict) return `That part number is already on ${mfrConflict}.`;
  const mkConflict = matchKeyConflict(candidate, all);
  if (mkConflict) return `That match key is already used by ${mkConflict}.`;
  return null;
}

export type SpecRecordHit = {
  specId: string;
  title: string;
  kind: SpecKind;
  status: SpecRecord["status"];
  section: string;
  manufacturer: string | null;
  mfrNumbers: string[];
  matchKey: string | null;
};

/** Search over records (title, specId, part numbers, manufacturer, match
 *  key) for Link-to-existing / Add-from-library (design §5.1, §5.3). Every
 *  token in `q` must appear somewhere in the haystack; `ready` first, then
 *  `draft`, each group sorted by specId; `archived` never matches. */
export async function searchSpecRecordsAction(
  q: string,
  opts?: { sectionNumber?: string; kinds?: SpecKind[] }
): Promise<Result<{ records: SpecRecordHit[] }>> {
  await requireUser();
  const tokens = String(q || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const sectionKey = opts?.sectionNumber ? csiKey(opts.sectionNumber) : "";
  const kinds = opts?.kinds && opts.kinds.length ? new Set(opts.kinds) : null;

  const all = await allSpecRecords();
  const candidates = all.filter((r) => {
    if (r.status === "archived") return false;
    if (kinds && !kinds.has(r.kind)) return false;
    if (sectionKey && csiKey(r.section) !== sectionKey) return false;
    if (!tokens.length) return true;
    const haystack = [r.specId, r.title, r.manufacturer || "", r.mfrNumbers.join(" "), r.matchKey || "", r.basisOfDesign || ""]
      .join(" ")
      .toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  });

  const order = (r: SpecRecord) => (r.status === "ready" ? 0 : 1);
  candidates.sort((a, b) => order(a) - order(b) || (a.specId < b.specId ? -1 : a.specId > b.specId ? 1 : 0));

  const records: SpecRecordHit[] = candidates.slice(0, 30).map((r) => ({
    specId: r.specId,
    title: r.title,
    kind: r.kind,
    status: r.status,
    section: r.section,
    manufacturer: r.manufacturer,
    mfrNumbers: r.mfrNumbers,
    matchKey: r.matchKey,
  }));
  return { ok: true, records };
}

/** Link-to-existing (design §5.1). A row with a part number adds it to the
 *  record's `mfrNumbers` (or, when the record already holds it, pins the
 *  row to that record); a system record with a row that has no part
 *  number sets the row's `specKey` to the record's match key; otherwise
 *  pins `specId` on the row. Refuses an archived record. */
export async function linkRowToRecordAction(docId: string, rowKey: string, specId: string): Promise<Result> {
  const user = await requirePerm("create");
  const doc = await getSpecDocument(docId);
  if (!doc) return { ok: false, error: "Spec not found." };
  const row = rowOnDoc(doc, rowKey);
  if (!row) return { ok: false, error: ROW_GONE };
  const record = await getSpecRecord(specId);
  if (!record) return { ok: false, error: "Spec record not found." };
  if (record.status === "archived") return { ok: false, error: "That spec record is archived." };

  const partNumber = await partNumberForRow(row);
  if (partNumber) {
    const norm = normPartNumber(partNumber);
    const already = record.mfrNumbers.some((m) => normPartNumber(m) === norm);
    // The record already holds this number (an ambiguous row's candidate, a
    // draft's, or a wildcard hit): adding it again would change nothing and
    // the row would stay unresolved — pin the row to the pick instead
    // (Task 9 fix round).
    if (already) return applyPatch(docId, user, (d) => withRowPin(d, rowKey, specId));
    const all = await allSpecRecords();
    const conflict = partNumberConflict({ ...record, mfrNumbers: [partNumber] }, all);
    if (conflict) return { ok: false, error: `That part number is already on ${conflict}.` };
    await saveSpecRecord({ ...record, mfrNumbers: [...record.mfrNumbers, partNumber] }, user.name, `Linked from ${docId}`);
    revalidateAll(docId);
    return { ok: true };
  }

  if (record.kind === "system") {
    if (!record.matchKey) return { ok: false, error: "That system record has no match key yet." };
    return applyPatch(docId, user, (d) => withRowSpecKey(d, rowKey, record.matchKey!));
  }

  return applyPatch(docId, user, (d) => withRowPin(d, rowKey, specId));
}

/** Pick one record for an ambiguous row (design §5.1: "Ambiguous rows pick
 *  among their candidates the same way (pin)") — always a pin, never a
 *  part-number add: every candidate already holds the row's number, so
 *  adding it again would change nothing and the row would stay ambiguous.
 *  Refuses an archived record. */
export async function pinRowToRecordAction(docId: string, rowKey: string, specId: string): Promise<Result> {
  const user = await requirePerm("create");
  const doc = await getSpecDocument(docId);
  if (!doc) return { ok: false, error: "Spec not found." };
  if (!rowOnDoc(doc, rowKey)) return { ok: false, error: ROW_GONE };
  const record = await getSpecRecord(specId);
  if (!record) return { ok: false, error: "Spec record not found." };
  if (record.status === "archived") return { ok: false, error: "That spec record is archived." };
  return applyPatch(docId, user, (d) => withRowPin(d, rowKey, specId));
}

/** Write new spec (design §5.1). Prefilled from the row; saves a new
 *  `ready` record at the next free id for the doc's section. A system
 *  record also sets the row's match key. */
export async function createRecordFromRowAction(
  docId: string,
  rowKey: string,
  input: {
    title: string;
    specText: string;
    kind: SpecKind;
    manufacturer?: string;
    basisOfDesign?: string;
    mfrNumbers: string[];
    matchKey?: string;
    sourceArticleId: string;
  }
): Promise<Result<{ specId: string }>> {
  const user = await requirePerm("create");
  const title = String(input.title ?? "").trim();
  const badTitle = tooLong(title, SPEC_OVERRIDE_TITLE_MAX, "the title");
  if (badTitle) return badTitle;
  const specText = String(input.specText ?? "");
  const badText = tooLong(specText, SPEC_OVERRIDE_TEXT_MAX, "spec text");
  if (badText) return badText;
  const mfrNumbers = Array.isArray(input.mfrNumbers) ? input.mfrNumbers.map((s) => String(s ?? "")) : [];
  if (mfrNumbers.length > MFR_NUMBERS_MAX) return { ok: false, error: `A spec record can't carry more than ${MFR_NUMBERS_MAX} part numbers.` };

  const doc = await getSpecDocument(docId);
  if (!doc) return { ok: false, error: "Spec not found." };
  const row = rowOnDoc(doc, rowKey);
  if (!row) return { ok: false, error: ROW_GONE };

  // Fetched once — sections/articles are needed both for the section/article
  // lookup below and for `validateSpecRecord`'s context (fix round 1: this
  // used to fetch both twice, once here and once inside `recordCtx()`).
  const [sections, articles, allRecords] = await Promise.all([allSections(), allArticles(), allSpecRecords()]);
  const section = sections.find((s) => s.id === doc.sectionId);
  if (!section) return { ok: false, error: "This spec's section no longer exists." };

  const sourceArticleId = String(input.sourceArticleId || "").trim();
  const article = articles.find((a) => a.id === sourceArticleId);

  const specId = await nextSpecId(section.number);
  const candidate = normalizeSpecRecord({
    specId,
    kind: input.kind,
    status: "ready",
    section: section.number,
    article: article?.title ?? "",
    title,
    basisOfDesign: input.basisOfDesign ?? null,
    manufacturer: input.manufacturer ?? null,
    mfrNumbers,
    matchKey: input.matchKey ?? null,
    includeWith: [],
    specText,
    notes: null,
    sourceArticleId: sourceArticleId || null,
    revision: 1,
    updatedAt: 0,
    updatedBy: user.name,
  });
  if (!candidate) return { ok: false, error: "That spec record isn't valid." };

  const ctx = {
    sections: sections.map((s) => ({ id: s.id, number: s.number })),
    articles: articles.map((a) => ({ id: a.id, sectionId: a.sectionId })),
    specIds: new Set(allRecords.map((r) => r.specId)),
  };
  const problems = validateSpecRecord(candidate, ctx).filter((p) => p.blocking);
  if (problems.length) return { ok: false, error: problems.map((p) => p.message).join(" ") };

  const conflict = conflictError(candidate, allRecords);
  if (conflict) return { ok: false, error: conflict };

  await saveSpecRecord(candidate, user.name, `Created from ${docId}`);
  if (candidate.kind === "system" && candidate.matchKey) {
    await patchSpecDocument(docId, (d) => withRowSpecKey(d, rowKey, candidate.matchKey!), user.name);
  }
  revalidateAll(docId);
  return { ok: true, specId };
}

/** Waive an unresolved row (design §5.1) — reason required, capped. */
export async function waiveRowAction(docId: string, rowKey: string, reason: string): Promise<Result> {
  const user = await requirePerm("create");
  const doc = await getSpecDocument(docId);
  if (!doc) return { ok: false, error: "Spec not found." };
  if (!rowOnDoc(doc, rowKey)) return { ok: false, error: ROW_GONE };
  const r = String(reason || "").trim();
  if (!r) return { ok: false, error: "A reason is required." };
  const badReason = tooLong(r, REASON_MAX, "the reason");
  if (badReason) return badReason;
  return applyPatch(docId, user, (d) => withWaive(d, rowKey, r));
}

export async function unwaiveRowAction(docId: string, rowKey: string): Promise<Result> {
  const user = await requirePerm("create");
  const doc = await getSpecDocument(docId);
  if (!doc) return { ok: false, error: "Spec not found." };
  if (!rowOnDoc(doc, rowKey)) return { ok: false, error: ROW_GONE };
  return applyPatch(docId, user, (d) => withoutWaive(d, rowKey));
}

/** Approve a draft match (design §5.1) — validates as `ready` first, then
 *  the same duplicate-part-number and match-key guards every other path to
 *  `ready` uses (fix round 1: approve used to skip these, so a draft could
 *  be approved straight into a collision another `ready` record already
 *  held). */
export async function approveDraftRecordAction(specId: string): Promise<Result> {
  const user = await requirePerm("create");
  const record = await getSpecRecord(specId);
  if (!record) return { ok: false, error: "Spec record not found." };
  if (record.status === "archived") return { ok: false, error: "That spec record is archived." };
  const next = { ...record, status: "ready" as const };
  const ctx = await recordCtx();
  const problems = validateSpecRecord(next, ctx).filter((p) => p.blocking);
  if (problems.length) return { ok: false, error: problems.map((p) => p.message).join(" ") };
  const conflict = conflictError(next, ctx.records);
  if (conflict) return { ok: false, error: conflict };
  await saveSpecRecord(next, user.name, "Approved");
  revalidateAll();
  return { ok: true };
}

/** Edit a matched row, "This project only" (design §5.2) — the library is
 *  unchanged; `baseRevision` is the record's current revision. */
export async function saveRowOverrideAction(
  docId: string,
  specId: string,
  input: { title: string; specText: string }
): Promise<Result> {
  const user = await requirePerm("create");
  const title = String(input.title ?? "").trim();
  const badTitle = tooLong(title, SPEC_OVERRIDE_TITLE_MAX, "the title");
  if (badTitle) return badTitle;
  const specText = String(input.specText ?? "");
  const badText = tooLong(specText, SPEC_OVERRIDE_TEXT_MAX, "spec text");
  if (badText) return badText;
  const record = await getSpecRecord(specId);
  if (!record) return { ok: false, error: "Spec record not found." };
  return applyPatch(docId, user, (d) => withOverride(d, specId, { title, specText, baseRevision: record.revision }));
}

export async function clearRowOverrideAction(docId: string, specId: string): Promise<Result> {
  const user = await requirePerm("create");
  return applyPatch(docId, user, (d) => withoutOverride(d, specId));
}

/** Edit a matched row, "Update the library" (design §5.2) — a new
 *  revision, why required, prior version kept in history. */
export async function updateLibraryRecordAction(
  specId: string,
  input: { title: string; specText: string },
  why: string
): Promise<Result<{ revision: number }>> {
  const user = await requirePerm("create");
  const w = String(why || "").trim();
  if (!w) return { ok: false, error: "A reason is required." };
  const badWhy = tooLong(w, WHY_MAX, "the reason");
  if (badWhy) return badWhy;
  const title = String(input.title ?? "").trim();
  const badTitle = tooLong(title, SPEC_OVERRIDE_TITLE_MAX, "the title");
  if (badTitle) return badTitle;
  const specText = String(input.specText ?? "");
  const badText = tooLong(specText, SPEC_OVERRIDE_TEXT_MAX, "spec text");
  if (badText) return badText;
  if (!title) return { ok: false, error: "Title is required." };
  if (!specText.trim()) return { ok: false, error: "Spec text is required." };

  const record = await getSpecRecord(specId);
  if (!record) return { ok: false, error: "Spec record not found." };
  const result = await saveSpecRecord({ ...record, title, specText }, user.name, w);
  revalidateAll();
  return { ok: true, revision: result.record.revision };
}

/** How many saved specs' last download printed this record (design §5.2
 *  "used on N saved specs", information only). */
export async function recordUsageAction(specId: string): Promise<Result<{ count: number }>> {
  await requireUser();
  const docs = await allSpecDocuments();
  const count = docs.filter((d) => specId in d.usedRecords).length;
  return { ok: true, count };
}

/** Add from Spec Library (design §5.3) — a `SPEC:<id>` row, idempotent.
 *  Refuses an archived record. */
export async function addLibraryRowAction(docId: string, specId: string): Promise<Result> {
  const user = await requirePerm("create");
  const record = await getSpecRecord(specId);
  if (!record) return { ok: false, error: "Spec record not found." };
  if (record.status === "archived") return { ok: false, error: "That spec record is archived." };
  return applyPatch(docId, user, (d) => withLibraryRow(d, specId));
}

/** The Spec Library screen's record editor (design §7) — normalizes and
 *  validates, then the same duplicate-part-number and match-key guards as
 *  Link/Write new. `why` is required only when editing an existing record
 *  (a brand-new one has nothing to explain yet).
 *
 *  A blank specId is a create: the id is ALWAYS allocated here from the
 *  chosen section (`nextSpecId`), never taken from the client — the editor
 *  only previews it. Allocating at save time rather than on page load makes
 *  a collision between two people creating in the same section unlikely;
 *  the allocated id is re-checked and re-allocated once if another save got
 *  there first, and sanity-checked against the allocator's own shape
 *  (`isValidSpecId`). A non-blank specId is an edit and only has to name an
 *  existing record — edits are never format-checked. */
export async function saveSpecRecordAction(
  record: unknown,
  why: string
): Promise<Result<{ specId: string; outcome: SaveOutcome }>> {
  const user = await requirePerm("create");
  const raw = (record && typeof record === "object" ? record : {}) as Record<string, unknown>;
  const givenId = String(raw.specId ?? "").trim();
  const isCreate = !givenId;
  let specId = givenId;
  if (isCreate) {
    const section = String(raw.section ?? "").trim();
    if (!csiKey(section)) return { ok: false, error: "Choose a section first." };
    specId = await nextSpecId(section);
    if (await getSpecRecord(specId)) specId = await nextSpecId(section); // someone saved that id meanwhile — retry once
    if (await getSpecRecord(specId)) return { ok: false, error: "Couldn't assign a Spec ID — try saving again." };
    // Sanity check on the allocator's own output (never applied to edits).
    if (!isValidSpecId(specId)) return { ok: false, error: `Couldn't assign a Spec ID for section "${section.slice(0, 40)}".` };
  }
  const normalized = normalizeSpecRecord({ ...raw, specId });
  if (!normalized) return { ok: false, error: "That spec record isn't valid." };

  // An edit only has to name an existing record — no format check, so
  // records created by Write new or by an import are never locked out.
  const existing = isCreate ? null : await getSpecRecord(specId);
  if (!isCreate && !existing) return { ok: false, error: "Spec record not found." };
  const w = String(why || "").trim();
  if (existing && !w) return { ok: false, error: "A reason is required." };
  const badWhy = tooLong(w, WHY_MAX, "the reason");
  if (badWhy) return badWhy;
  const badTitle = tooLong(normalized.title, SPEC_OVERRIDE_TITLE_MAX, "the title");
  if (badTitle) return badTitle;
  const badText = tooLong(normalized.specText, SPEC_OVERRIDE_TEXT_MAX, "spec text");
  if (badText) return badText;
  if (normalized.mfrNumbers.length > MFR_NUMBERS_MAX) {
    return { ok: false, error: `A spec record can't carry more than ${MFR_NUMBERS_MAX} part numbers.` };
  }

  const ctx = await recordCtx();
  const problems = validateSpecRecord(normalized, ctx).filter((p) => p.blocking);
  if (problems.length) return { ok: false, error: problems.map((p) => p.message).join(" ") };

  const conflict = conflictError(normalized, ctx.records);
  if (conflict) return { ok: false, error: conflict };

  const result = await saveSpecRecord(normalized, user.name, w);
  revalidateAll();
  return { ok: true, specId: result.record.specId, outcome: result.outcome };
}

/** Restore a prior revision (design §1.2) — a new revision, never a rewind.
 *  Fix round 1: if the version being restored is `ready`, it goes through
 *  the same duplicate-part-number/match-key guards as every other path to
 *  `ready` — restoring a `ready` revision could otherwise reintroduce a
 *  collision the library has since resolved. A `draft`/`archived` target
 *  needs no guard (design §1.1: those statuses never participate in
 *  matching, so they can't collide). */
export async function restoreSpecRecordRevisionAction(
  specId: string,
  revision: number
): Promise<Result<{ outcome: SaveOutcome }>> {
  const user = await requirePerm("create");
  const rev = Number(revision);
  const revs = await specRecordRevisions(specId);
  const target = revs.find((r) => r.revision === rev);
  if (!target) return { ok: false, error: `No revision ${rev} found for ${specId}.` };
  if (target.record.status === "ready") {
    const all = await allSpecRecords();
    const conflict = conflictError({ ...target.record, specId }, all);
    if (conflict) return { ok: false, error: conflict };
  }
  const result = await restoreSpecRecordRevision(specId, rev, user.name);
  if (!result.ok) return { ok: false, error: result.error };
  revalidateAll();
  return { ok: true, outcome: result.outcome };
}

/* ---- Spec Library screen: Import .xlsx (design §2, §7) ---- */

export type SpecRecordImportPreview = {
  fileName: string;
  counts: ImportPlan["counts"];
  problems: RecordProblem[];
  missingSections: string[];
  blocking: boolean;
  /** Records the import would create or change (unchanged ones omitted). */
  changes: Array<{ specId: string; action: "create" | "update"; title: string }>;
};

/** The uploaded file from the form, after the cheap name/size guard — the
 *  bytes are only read once the file has passed it. */
function uploadedFile(form: FormData): { ok: true; file: File } | { ok: false; error: string } {
  const file = form.get("file");
  if (!file || typeof file === "string") return { ok: false, error: "Choose a file first." };
  const refused = checkSpecRecordImportFile(file.name, file.size);
  if (refused) return { ok: false, error: refused };
  return { ok: true, file };
}

/** Import .xlsx, step 1: read + plan the uploaded file against the live
 *  library and report what an import would do. Writes nothing. */
export async function previewSpecRecordImportAction(form: FormData): Promise<Result<{ preview: SpecRecordImportPreview }>> {
  await requirePerm("create");
  const up = uploadedFile(form);
  if (!up.ok) return up;
  const { file } = up;
  try {
    const res = await planSpecRecordImportFile(file.name, await file.arrayBuffer());
    if (!res.ok) return res;
    const { plan } = res;
    return {
      ok: true,
      preview: {
        fileName: file.name,
        counts: plan.counts,
        problems: plan.problems,
        missingSections: plan.missingSections,
        blocking: plan.blocking,
        changes: plan.items
          .filter((i) => i.action !== "unchanged")
          .map((i) => ({ specId: i.specId, action: i.action as "create" | "update", title: i.record.title })),
      },
    };
  } catch (e) {
    console.error("previewSpecRecordImportAction", e);
    return { ok: false, error: "Could not read that file. Try again." };
  }
}

type ImportCommitResult = { created: number; updated: number; unchanged: number; sectionsCreated: string[] };

/** Import .xlsx, step 2 (Confirm): re-reads and re-plans the SAME uploaded
 *  file on the server — never a plan from the client — refuses a blocking
 *  plan, then commits every change through `saveSpecRecord` with why
 *  "Import <filename>". */
export async function commitSpecRecordImportAction(form: FormData): Promise<Result<ImportCommitResult>> {
  const user = await requirePerm("create");
  const up = uploadedFile(form);
  if (!up.ok) return up;
  const { file } = up;
  try {
    const res = await planSpecRecordImportFile(file.name, await file.arrayBuffer());
    if (!res.ok) return res;
    if (res.plan.blocking) {
      const n = res.plan.problems.filter((p) => p.blocking).length;
      return { ok: false, error: `This file has ${n} blocking problem${n === 1 ? "" : "s"} — fix them and preview again. Nothing was imported.` };
    }
    const result = await commitSpecRecordImport(res.plan, user.name, `Import ${file.name}`);
    revalidateAll();
    return { ok: true, ...result };
  } catch (e) {
    console.error("commitSpecRecordImportAction", e);
    return { ok: false, error: "Could not import that file. Records saved before the failure keep their changes." };
  }
}

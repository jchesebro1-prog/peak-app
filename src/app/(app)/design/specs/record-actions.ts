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
import { isPlaceholderSku, normMatchKey, normPartNumber, specRowKey } from "@/lib/specs/record-keys";
import { normalizeSpecRecord, validateSpecRecord, type SpecKind, type SpecRecord } from "@/lib/specs/records";
import { csiKey } from "@/lib/specs/articles";

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

async function recordCtx(): Promise<{
  sections: Array<{ id: string; number: string }>;
  articles: Array<{ id: string; sectionId: string }>;
  specIds: Set<string>;
}> {
  const [sections, articles, records] = await Promise.all([allSections(), allArticles(), allSpecRecords()]);
  return {
    sections: sections.map((s) => ({ id: s.id, number: s.number })),
    articles: articles.map((a) => ({ id: a.id, sectionId: a.sectionId })),
    specIds: new Set(records.map((r) => r.specId)),
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

/** The specId of another `ready` record that already carries one of
 *  `mfrNumbers` (normalized), or `null` — the guard that keeps a part
 *  number from ever matching two records (design §2, §3.2, §5.1). */
async function partNumberConflict(specId: string, mfrNumbers: string[], all?: SpecRecord[]): Promise<string | null> {
  const records = all ?? (await allSpecRecords());
  const norms = mfrNumbers.map(normPartNumber).filter(Boolean);
  if (!norms.length) return null;
  for (const r of records) {
    if (r.specId === specId || r.status !== "ready") continue;
    if (r.mfrNumbers.some((m) => norms.includes(normPartNumber(m)))) return r.specId;
  }
  return null;
}

/** The specId of another non-archived `system` record sharing `matchKey`
 *  (normalized), or `null` (design §5.1 resolution: "the match key must not
 *  already be on another non-archived system record"). */
async function matchKeyConflict(
  specId: string,
  kind: SpecKind,
  matchKey: string | null,
  all?: SpecRecord[]
): Promise<string | null> {
  if (kind !== "system" || !matchKey) return null;
  const records = all ?? (await allSpecRecords());
  const norm = normMatchKey(matchKey);
  for (const r of records) {
    if (r.specId === specId || r.status === "archived" || r.kind !== "system" || !r.matchKey) continue;
    if (normMatchKey(r.matchKey) === norm) return r.specId;
  }
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
 *  record's `mfrNumbers`; a system record with a row that has no part
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
    if (!already) {
      const conflict = await partNumberConflict(specId, [partNumber]);
      if (conflict) return { ok: false, error: `That part number is already on ${conflict}.` };
      await saveSpecRecord({ ...record, mfrNumbers: [...record.mfrNumbers, partNumber] }, user.name, `Linked from ${docId}`);
    }
    revalidateAll(docId);
    return { ok: true };
  }

  if (record.kind === "system") {
    if (!record.matchKey) return { ok: false, error: "That system record has no match key yet." };
    return applyPatch(docId, user, (d) => withRowSpecKey(d, rowKey, record.matchKey!));
  }

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

  const sections = await allSections();
  const section = sections.find((s) => s.id === doc.sectionId);
  if (!section) return { ok: false, error: "This spec's section no longer exists." };

  const articles = await allArticles();
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

  const ctx = await recordCtx();
  const problems = validateSpecRecord(candidate, ctx).filter((p) => p.blocking);
  if (problems.length) return { ok: false, error: problems.map((p) => p.message).join(" ") };

  const mfrConflict = await partNumberConflict(specId, candidate.mfrNumbers);
  if (mfrConflict) return { ok: false, error: `That part number is already on ${mfrConflict}.` };
  const mkConflict = await matchKeyConflict(specId, candidate.kind, candidate.matchKey);
  if (mkConflict) return { ok: false, error: `That match key is already used by ${mkConflict}.` };

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

/** Approve a draft match (design §5.1) — validates first. */
export async function approveDraftRecordAction(specId: string): Promise<Result> {
  const user = await requirePerm("create");
  const record = await getSpecRecord(specId);
  if (!record) return { ok: false, error: "Spec record not found." };
  if (record.status === "archived") return { ok: false, error: "That spec record is archived." };
  const next = { ...record, status: "ready" as const };
  const ctx = await recordCtx();
  const problems = validateSpecRecord(next, ctx).filter((p) => p.blocking);
  if (problems.length) return { ok: false, error: problems.map((p) => p.message).join(" ") };
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
  const title = String(input.title ?? "");
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
 *  (a brand-new one has nothing to explain yet). */
export async function saveSpecRecordAction(
  record: unknown,
  why: string
): Promise<Result<{ specId: string; outcome: "created" | "updated" | "unchanged" }>> {
  const user = await requirePerm("create");
  const normalized = normalizeSpecRecord(record);
  if (!normalized) return { ok: false, error: "That spec record isn't valid." };

  const existing = await getSpecRecord(normalized.specId);
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

  const mfrConflict = await partNumberConflict(normalized.specId, normalized.mfrNumbers);
  if (mfrConflict) return { ok: false, error: `That part number is already on ${mfrConflict}.` };
  const mkConflict = await matchKeyConflict(normalized.specId, normalized.kind, normalized.matchKey);
  if (mkConflict) return { ok: false, error: `That match key is already used by ${mkConflict}.` };

  const result = await saveSpecRecord(normalized, user.name, w);
  revalidateAll();
  return { ok: true, specId: result.record.specId, outcome: result.outcome };
}

export async function restoreSpecRecordRevisionAction(specId: string, revision: number): Promise<Result> {
  const user = await requirePerm("create");
  const result = await restoreSpecRecordRevision(specId, Number(revision), user.name);
  if (!result.ok) return { ok: false, error: result.error };
  revalidateAll();
  return { ok: true };
}

/**
 * Spec Library records (#205 follow-on, spec 2026-09-28-spec-records-design.md
 * §1.1) — the pure model for `spec_records`. A record is written once per
 * product/system/companion and matched against BOM rows any number of times.
 *
 * Pure on purpose: no store imports, no `Date.now()`, no environment. This is
 * what lets normalization/validation run identically in the importer, the
 * builder's live preview and the server-side commit path.
 */

import { csiKey } from "@/lib/specs/articles";
import { normMatchKey, normPartNumber } from "@/lib/specs/record-keys";

export type SpecKind = "product_catalog" | "product_vendor" | "system" | "companion";
export type SpecStatus = "draft" | "ready" | "archived";

export const SPEC_KINDS: readonly SpecKind[] = ["product_catalog", "product_vendor", "system", "companion"];
export const SPEC_STATUSES: readonly SpecStatus[] = ["draft", "ready", "archived"];

export type SpecRecord = {
  specId: string;
  kind: SpecKind;
  status: SpecStatus;
  section: string;
  article: string;
  title: string;
  basisOfDesign: string | null;
  manufacturer: string | null;
  mfrNumbers: string[];
  matchKey: string | null;
  includeWith: string[];
  specText: string;
  notes: string | null;
  sourceArticleId: string | null;
  revision: number;
  updatedAt: number;
  updatedBy: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function trimmedOrNull(v: unknown): string | null {
  const s = str(v).trim();
  return s === "" ? null : s;
}

/** Splits on newline/comma/semicolon runs, trims, drops blanks, de-dups
 *  case-insensitively keeping the first spelling seen. Accepts an array
 *  (each entry trimmed, not re-split) or a string. */
function splitList(v: unknown): string[] {
  const parts = Array.isArray(v)
    ? v.map((x) => str(x).trim())
    : str(v)
        .split(/[\n,;]+/)
        .map((x) => x.trim());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** Normalizes a raw (importer row / form / doc) shape into a `SpecRecord`, or
 *  `null` when it can't be — an empty `specId` or an unrecognized `kind` are
 *  refusals, never silently defaulted. Everything else has a safe default. */
export function normalizeSpecRecord(raw: unknown): SpecRecord | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const specId = str(o.specId).trim();
  if (!specId) return null;

  const kind = str(o.kind).trim() as SpecKind;
  if (!SPEC_KINDS.includes(kind)) return null;

  const statusRaw = str(o.status).trim() as SpecStatus;
  const status: SpecStatus = SPEC_STATUSES.includes(statusRaw) ? statusRaw : "draft";

  const revisionRaw = Number(o.revision);
  const revision = Number.isFinite(revisionRaw) && Math.floor(revisionRaw) >= 1 ? Math.floor(revisionRaw) : 1;

  const updatedAtRaw = Number(o.updatedAt);
  const updatedAt = Number.isFinite(updatedAtRaw) ? updatedAtRaw : 0;

  return {
    specId,
    kind,
    status,
    section: str(o.section).trim(),
    article: str(o.article).trim(),
    title: str(o.title).trim(),
    basisOfDesign: trimmedOrNull(o.basisOfDesign),
    manufacturer: trimmedOrNull(o.manufacturer),
    mfrNumbers: splitList(o.mfrNumbers),
    matchKey: trimmedOrNull(o.matchKey),
    includeWith: splitList(o.includeWith),
    specText: str(o.specText),
    notes: trimmedOrNull(o.notes),
    sourceArticleId: trimmedOrNull(o.sourceArticleId),
    revision,
    updatedAt,
    updatedBy: str(o.updatedBy),
  };
}

/** True when two records have the same content — everything except
 *  `revision`/`updatedAt`/`updatedBy`. `mfrNumbers`/`includeWith` are
 *  compared in order, after normalizing each side (so a record built by hand
 *  and one round-tripped through `normalizeSpecRecord` still compare equal). */
export function sameSpecContent(a: SpecRecord, b: SpecRecord): boolean {
  const an = normalizeSpecRecord(a);
  const bn = normalizeSpecRecord(b);
  if (!an || !bn) return false;
  return (
    an.specId === bn.specId &&
    an.kind === bn.kind &&
    an.status === bn.status &&
    an.section === bn.section &&
    an.article === bn.article &&
    an.title === bn.title &&
    an.basisOfDesign === bn.basisOfDesign &&
    an.manufacturer === bn.manufacturer &&
    an.matchKey === bn.matchKey &&
    an.specText === bn.specText &&
    an.notes === bn.notes &&
    an.sourceArticleId === bn.sourceArticleId &&
    an.mfrNumbers.length === bn.mfrNumbers.length &&
    an.mfrNumbers.every((v, i) => v === bn.mfrNumbers[i]) &&
    an.includeWith.length === bn.includeWith.length &&
    an.includeWith.every((v, i) => v === bn.includeWith[i])
  );
}

export type RecordProblem = { specId: string; field: string; message: string; blocking: boolean };

export type RecordValidationCtx = {
  sections: Array<{ id: string; number: string }>;
  articles: Array<{ id: string; sectionId: string }>;
  specIds: Set<string>;
};

/** The live section id a record's `section` (a CSI number) resolves to, or
 *  `null` when it doesn't match exactly one live section (via `csiKey`). */
export function sectionIdForRecord(r: SpecRecord, sections: Array<{ id: string; number: string }>): string | null {
  const key = csiKey(r.section);
  if (!key) return null;
  const hits = sections.filter((s) => csiKey(s.number) === key);
  return hits.length === 1 ? hits[0].id : null;
}

export function validateSpecRecord(r: SpecRecord, ctx: RecordValidationCtx): RecordProblem[] {
  const problems: RecordProblem[] = [];
  const problem = (field: string, message: string, blocking: boolean) =>
    problems.push({ specId: r.specId, field, message, blocking });

  if (!r.title.trim()) problem("title", "Title is required.", true);
  if (!r.specText.trim()) problem("specText", "Spec text is required.", true);

  if ((r.kind === "product_catalog" || r.kind === "product_vendor") && r.mfrNumbers.length === 0) {
    problem("mfrNumbers", "A product record needs at least one MFR #.", true);
  }
  if (r.kind === "system" && !r.matchKey) {
    problem("matchKey", "A system record needs a match key.", true);
  }
  if (r.kind === "companion") {
    if (r.includeWith.length === 0) {
      problem("includeWith", "A companion record needs at least one spec it rides with.", true);
    } else {
      for (const id of r.includeWith) {
        if (!ctx.specIds.has(id)) {
          problem("includeWith", `"${id}" is not a known spec id.`, true);
        }
      }
    }
  }

  const sectionId = sectionIdForRecord(r, ctx.sections);
  if (!sectionId) {
    problem("section", `"${r.section}" does not resolve to exactly one section.`, true);
  }

  // Article placement is always checked, but only blocking for `ready`
  // records — a draft/archived record can point at nothing yet, or at a
  // stale article, without blocking anyone.
  const articleBlocking = r.status === "ready";
  if (!r.sourceArticleId) {
    problem("sourceArticleId", "A ready record needs a source article.", articleBlocking);
  } else {
    const article = ctx.articles.find((a) => a.id === r.sourceArticleId);
    if (!article) {
      problem("sourceArticleId", `"${r.sourceArticleId}" is not a known article.`, articleBlocking);
    } else if (!sectionId || article.sectionId !== sectionId) {
      problem("sourceArticleId", "The source article is not in this record's section.", articleBlocking);
    }
  }

  return problems;
}

export const KIND_LABELS: Record<SpecKind, string> = {
  product_catalog: "Product – catalog",
  product_vendor: "Product – vendor quote",
  system: "System (custom, no part #)",
  companion: "Companion",
};

/** Reverse of `KIND_LABELS`, tolerant of workbook drift: exact label match,
 *  the raw enum value, or the lowercased leading text. */
export function kindFromLabel(label: string): SpecKind | null {
  const raw = str(label).trim();
  if (!raw) return null;
  if (SPEC_KINDS.includes(raw as SpecKind)) return raw as SpecKind;
  for (const kind of SPEC_KINDS) {
    if (KIND_LABELS[kind] === raw) return kind;
  }
  const lower = raw.toLowerCase();
  if (lower.startsWith("product")) {
    return lower.includes("vendor") ? "product_vendor" : "product_catalog";
  }
  if (lower.startsWith("system")) return "system";
  if (lower.startsWith("companion")) return "companion";
  return null;
}

/** Reads a workbook status label (Ready/Draft/Archived, case-insensitive).
 *  Unknown labels default to "draft" — this is the ONLY place that lenient
 *  default lives; `normalizeSpecRecord`'s `status` field must already be an
 *  exact enum value. */
export function statusFromLabel(label: string): SpecStatus {
  const lower = str(label).trim().toLowerCase();
  return (SPEC_STATUSES as readonly string[]).includes(lower) ? (lower as SpecStatus) : "draft";
}

/** Next `PS-<digits>-<NNN>` id for a section, 3-digit zero-padded, one past
 *  the highest existing sequence number under that same section's digits.
 *  Ids under a different section's digits are ignored. */
export function nextSpecIdFor(sectionNumber: string, existing: Iterable<string>): string {
  const digits = csiKey(sectionNumber);
  let max = 0;
  const prefix = `PS-${digits}-`;
  for (const id of existing) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  const next = max + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

/* ---- Cross-record guards (spec records design §2, §3.2, §5.1) — pure, so
 * the importer's plan, the record server actions, and any future caller
 * check the same rule the same way. Both take the full candidate record
 * (not just the field being checked) plus every other record, and return
 * the conflicting specId, or `null`. The candidate's own specId is always
 * excluded, so re-saving a record unchanged never conflicts with itself. */

/** The specId of another `ready` record that already carries one of
 *  `candidate.mfrNumbers` (normalized) — a part number may never match two
 *  records. An `archived` holder of the number never counts. */
export function partNumberConflict(candidate: SpecRecord, all: readonly SpecRecord[]): string | null {
  const norms = candidate.mfrNumbers.map(normPartNumber).filter(Boolean);
  if (!norms.length) return null;
  for (const r of all) {
    if (r.specId === candidate.specId || r.status !== "ready") continue;
    if (r.mfrNumbers.some((m) => norms.includes(normPartNumber(m)))) return r.specId;
  }
  return null;
}

/** The specId of another non-`archived` `system` record whose match key
 *  equals `candidate.matchKey` (case- and dash-insensitive, via
 *  `normMatchKey`) — only meaningful for a `system` candidate with a match
 *  key; anything else never conflicts. */
export function matchKeyConflict(candidate: SpecRecord, all: readonly SpecRecord[]): string | null {
  if (candidate.kind !== "system" || !candidate.matchKey) return null;
  const norm = normMatchKey(candidate.matchKey);
  for (const r of all) {
    if (r.specId === candidate.specId || r.status === "archived" || r.kind !== "system" || !r.matchKey) continue;
    if (normMatchKey(r.matchKey) === norm) return r.specId;
  }
  return null;
}

/* ---- Spec Library screen (design §7) — pure helpers for the records view
 * and the record editor's history panel. */

export type SpecRecordFilter = { q?: string; kind?: string; section?: string; status?: string; mfr?: string };

/** The records view's URL filters. Blank values don't filter. `kind` and
 *  `status` are exact enum values; `section` matches by CSI number via
 *  `csiKey` (so "26 09 61" and "260961" agree); `mfr` is an exact,
 *  case-insensitive manufacturer match; `q` is a case-insensitive substring
 *  over spec id, title, article, manufacturer, basis of design, match key
 *  and every part number. */
export function filterSpecRecords(records: readonly SpecRecord[], f: SpecRecordFilter): SpecRecord[] {
  const q = str(f.q).trim().toLowerCase();
  const kind = str(f.kind).trim();
  const status = str(f.status).trim();
  const sectionKey = csiKey(str(f.section));
  const mfr = str(f.mfr).trim().toLowerCase();
  return records.filter((r) => {
    if (kind && r.kind !== kind) return false;
    if (status && r.status !== status) return false;
    if (sectionKey && csiKey(r.section) !== sectionKey) return false;
    if (mfr && (r.manufacturer ?? "").trim().toLowerCase() !== mfr) return false;
    if (q) {
      const hay = [r.specId, r.title, r.article, r.manufacturer, r.basisOfDesign, r.matchKey, ...r.mfrNumbers]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export type SpecRecordRevisionLike = {
  revision: number;
  record: SpecRecord;
  savedAt: number;
  savedBy: string;
  why: string;
};

export type SpecRecordHistoryEntry = {
  revision: number;
  record: SpecRecord;
  at: number;
  by: string;
  why: string;
  current: boolean;
};

/** Newest-first timeline of every version of a record: the current one plus
 *  each stored prior version. A stored revision row N holds version N and
 *  the `why` of the save that REPLACED it (the save that made N + 1), so a
 *  version's own reason is row N − 1's `why`; version 1 is "Created". Who
 *  and when come from the version itself (`updatedBy`/`updatedAt`). */
export function specRecordHistory(current: SpecRecord, revisions: readonly SpecRecordRevisionLike[]): SpecRecordHistoryEntry[] {
  const whyFor = new Map<number, string>();
  for (const r of revisions) whyFor.set(r.revision + 1, r.why);
  const entry = (record: SpecRecord, isCurrent: boolean): SpecRecordHistoryEntry => ({
    revision: record.revision,
    record,
    at: record.updatedAt,
    by: record.updatedBy,
    why: whyFor.get(record.revision) ?? (record.revision === 1 ? "Created" : ""),
    current: isCurrent,
  });
  const out = [entry(current, true)];
  for (const r of revisions) {
    if (r.revision === current.revision) continue;
    out.push(entry({ ...r.record, revision: r.revision }, false));
  }
  return out.sort((a, b) => b.revision - a.revision);
}

/** The shape `nextSpecIdFor` emits — `PS-<section letters/digits>-<3+
 *  digit sequence>` (≤ 32 chars): the section part keeps every letter and
 *  digit of the CSI number (e.g. `PS-11614313-001`) and the sequence grows
 *  past 999 (`PS-260961-1000`). Only the editor's CREATE path checks it, as
 *  a sanity check on the allocated id; edits of an existing record and the
 *  import planner never format-check ids. */
export const SPEC_ID_PATTERN = /^PS-[0-9A-Za-z]+-\d{3,}$/;
export const SPEC_ID_MAX = 32;
export function isValidSpecId(id: string): boolean {
  return typeof id === "string" && id.length <= SPEC_ID_MAX && SPEC_ID_PATTERN.test(id);
}

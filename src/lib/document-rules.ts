import { categoryLabel, type DocumentCategory } from "./document-categories";
import { cleanText, formatBytes, titleFromFileName } from "./document-files";

/**
 * Documents (#218) — the record and its view models. Pure: client components
 * import the types and view models; the store, the finalize step and the
 * download route call the same functions. (The customer portal that shared
 * documents both ways was removed; `visibility` / `source` / `seenByTeamAt`
 * stay on stored records.)
 */

export type DocumentVisibility = "internal" | "shared";
export type DocumentSource = "team" | "customer";

export type DocumentRecord = {
  /** "DOC-" + sequence from 1000. */
  id: string;
  /** 1–200, defaults to the file name without extension. */
  title: string;
  /** Original name, control characters stripped (safe in a header). */
  fileName: string;
  /** From the browser — informational only; downloads are octet-stream. */
  mime: string;
  /** Bytes, as Blob reports them (≤ 100 MB). */
  size: number;
  /** `documents/<customer>/<uploadKey>/<file>-<suffix>` — private Blob. */
  blobPath: string;
  category: string;
  /** Stored by the removed portal sharing ("shared" = was visible on the customer portal). Nothing reads it now. */
  visibility: DocumentVisibility;
  source: DocumentSource;
  /** Required — every document belongs to a company. Never changes. */
  customerId: string;
  /** Optional venue of that company (the doc-side location id, docLocId). */
  siteId: string | null;
  /** Optional project of that company. */
  projectId: string | null;
  notes: string;
  /** Team user name, or the portal person's name. */
  uploadedBy: string;
  uploadedAt: number;
  /** Customer uploads: null until a team member opens/acknowledges. */
  seenByTeamAt: number | null;
  deleted?: true;
};

export const MAX_TITLE = 200;
export const MAX_NOTES = 2000;

export function isVisibility(v: unknown): v is DocumentVisibility {
  return v === "internal" || v === "shared";
}

/** Controls, invisible characters and lone surrogates dropped; capped at
 *  MAX_TITLE code points (never half an emoji); blank → the file's title. */
export function cleanTitle(raw: unknown, fileName: string): string {
  return cleanText(raw, MAX_TITLE) || cleanText(titleFromFileName(fileName), MAX_TITLE);
}

/** cleanTitle's rules, but line breaks (and tabs) survive. */
export function cleanNotes(raw: unknown): string {
  return cleanText(raw, MAX_NOTES, { multiline: true });
}

export function cleanMime(raw: unknown): string {
  const m = String(raw ?? "").trim().toLowerCase();
  return m.length <= 120 && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(m) ? m : "application/octet-stream";
}

export type DocumentFilter = {
  customerId?: string;
  /** undefined = any venue; null = company-wide files only. */
  siteId?: string | null;
  projectId?: string | null;
  visibility?: DocumentVisibility;
  category?: string;
};

/** Keeps input order. Deleted rows never pass. */
export function filterDocuments(docs: readonly DocumentRecord[], f: DocumentFilter = {}): DocumentRecord[] {
  return docs.filter((d) => {
    if (d.deleted) return false;
    if (f.customerId !== undefined && d.customerId !== f.customerId) return false;
    if (f.siteId !== undefined && (d.siteId || null) !== f.siteId) return false;
    if (f.projectId !== undefined && (d.projectId || null) !== f.projectId) return false;
    if (f.visibility && d.visibility !== f.visibility) return false;
    if (f.category && d.category !== f.category) return false;
    return true;
  });
}

export type DocumentScopeFacts = {
  customerExists: boolean;
  /** The company's venues, as doc-side location ids (docLocId). */
  siteIds: readonly string[];
  project: { id: string; customerId: string | null; locationId: string | null } | null;
};

/** Venue/project for a document of `customerId`: both must belong to that
 *  company; a project file with no venue takes the project's venue. */
export function resolveDocumentScope(
  input: { siteId?: string | null; projectId?: string | null },
  customerId: string,
  facts: DocumentScopeFacts
): { ok: true; siteId: string | null; projectId: string | null } | { ok: false; error: string } {
  if (!customerId || !facts.customerExists) return { ok: false, error: "That company no longer exists." };
  const projectId = String(input.projectId ?? "").trim() || null;
  let siteId = String(input.siteId ?? "").trim() || null;
  if (projectId) {
    if (!facts.project || facts.project.id !== projectId) return { ok: false, error: "That project no longer exists." };
    if (facts.project.customerId !== customerId) return { ok: false, error: "That project belongs to another company." };
    if (!siteId && facts.project.locationId && facts.siteIds.includes(facts.project.locationId)) siteId = facts.project.locationId;
  }
  if (siteId && !facts.siteIds.includes(siteId)) return { ok: false, error: "That venue belongs to another company." };
  return { ok: true, siteId, projectId };
}

export type DocumentOption = { id: string; label: string };

/** Serializable row for the team card (never carries blobPath). */
export type DocumentRowVM = {
  id: string;
  title: string;
  fileName: string;
  size: number;
  sizeLabel: string;
  category: string;
  categoryLabel: string;
  siteId: string | null;
  siteLabel: string;
  projectId: string | null;
  projectLabel: string;
  visibility: DocumentVisibility;
  source: DocumentSource;
  isNew: boolean;
  uploadedBy: string;
  uploadedAt: number;
  notes: string;
};

export function documentRows(
  docs: readonly DocumentRecord[],
  ctx: { categories: readonly DocumentCategory[]; venues: readonly DocumentOption[]; projects: readonly DocumentOption[] }
): DocumentRowVM[] {
  const venue = new Map(ctx.venues.map((v) => [v.id, v.label]));
  const project = new Map(ctx.projects.map((p) => [p.id, p.label]));
  return docs
    .filter((d) => !d.deleted)
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
    .map((d) => ({
      id: d.id,
      title: d.title,
      fileName: d.fileName,
      size: d.size,
      sizeLabel: formatBytes(d.size),
      category: d.category,
      categoryLabel: categoryLabel(ctx.categories, d.category),
      siteId: d.siteId,
      siteLabel: d.siteId ? venue.get(d.siteId) ?? "Removed venue" : "",
      projectId: d.projectId,
      projectLabel: d.projectId ? project.get(d.projectId) ?? d.projectId : "",
      visibility: d.visibility,
      source: d.source,
      isNew: d.source === "customer" && d.seenByTeamAt == null,
      uploadedBy: d.uploadedBy,
      uploadedAt: d.uploadedAt,
      notes: d.notes,
    }));
}


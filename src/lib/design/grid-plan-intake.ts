import { cleanPackageFiles, PACKAGE_FILE_TYPES, sniffPackageFile, type PackageFileType } from "@/lib/estimate-output/package-files";
import { formatBytes } from "@/lib/document-files";
import type { DocumentCategory } from "@/lib/document-categories";
import { sheetMimeVerdict } from "@/lib/grid-sheet-file";

/**
 * #314 — the Grid intake's "Plan view": an optional PDF/image that becomes the
 * design's FIRST sheet when the intake is saved (the generated venue-template
 * base sheet is still made, behind it). When the job already has a plan on
 * file, the intake offers it pre-attached ("Use plan from …", on by default):
 *
 * - an estimate-linked design: the quote's own Plans & risers uploads
 *   (`packageFiles`, kind Plan or Drawing set — never a Grid-generated set,
 *   that one is drawn FROM this design);
 * - any design with a customer: that company's `documents` in a plan-like
 *   category (the editable list — key `drawings`, or a label naming plans or
 *   drawings), company-wide or for the design's venue (never another venue's).
 *
 * Pure and client-safe. A candidate never carries a blob path: the client
 * sends back only its id, and the server re-derives the list from its own
 * reads before copying (grid-plan-intake-server.ts) — Blob to Blob, no bytes
 * through the browser — re-checking type by magic bytes and size.
 */

export type PlanCandidateSource = "estimate" | "documents";

export type PlanCandidate = {
  /** "pf:PF-…" (estimate package file) or "doc:DOC-…" (company document). */
  id: string;
  source: PlanCandidateSource;
  /** "EST-1042 · Plans & risers" / "Company files · Drawings". */
  from: string;
  name: string;
  sizeLabel: string;
};

/** Server-only twin of a candidate: where its bytes are. Never sent to a client. */
export type PlanCandidateFile = PlanCandidate & { blobPath: string; size: number; mime: string };

/**
 * Largest plan a server-side copy accepts. NOT the 4 MB upload cap: that one is
 * the Vercel function body limit (grid-sheet-file.ts), which a Blob-to-Blob
 * copy never crosses. 25 MB is the Plans & risers upload cap the source file
 * already passed (D-#314 plan view).
 */
export const GRID_PLAN_COPY_MAX_BYTES = 25 * 1024 * 1024;
export const GRID_PLAN_MAX_CANDIDATES = 20;

export const GRID_PLAN_COPY = {
  gone: "That plan is no longer on file — pick another or drop the file.",
  wrongType: "That plan isn't a PDF, PNG, JPEG or WebP file.",
  tooBig: "That plan is over 25 MB.",
  noStorage: "File storage isn't configured on this server.",
  failed: "Couldn't copy the plan — try again.",
} as const;

/** A document category that holds plans: the seeded `drawings` key, or a label naming plans or drawings. */
export function isPlanCategory(c: Pick<DocumentCategory, "key" | "label">): boolean {
  return c.key === "drawings" || /\b(plans?|drawings?|cad|blueprints?|floor ?plans?|architectural)\b/i.test(c.label || "");
}

/** A file a plan sheet may be made from, by its declared type or (documents' mime is informational) its name. */
export function looksLikePlanFile(mime: string, name: string): boolean {
  if (sheetMimeVerdict(mime) === "ok" && /^(application\/pdf|image\/(png|jpe?g|webp))/i.test((mime || "").trim())) return true;
  return /\.(pdf|png|jpe?g|webp)$/i.test(name || "");
}

type DocLike = { id: string; title?: string; fileName?: string; mime?: string; size?: number; blobPath?: string; category?: string; siteId?: string | null; uploadedAt?: number; deleted?: unknown };

/**
 * The plan candidates for one design, in offer order: the estimate's Plans &
 * risers first (newest first), then company documents (newest first).
 * `siteLocId` is the design's venue (the doc-side location id); "" = no venue,
 * in which case only company-wide documents are offered.
 */
export function planCandidatesFrom(input: {
  quoteNumber?: string | null;
  packageFiles?: unknown;
  documents?: readonly DocLike[];
  categories?: readonly DocumentCategory[];
  siteLocId?: string | null;
}): PlanCandidateFile[] {
  const out: PlanCandidateFile[] = [];
  if (input.quoteNumber) {
    const files = cleanPackageFiles(input.packageFiles)
      .filter((f) => f.source === "upload" && (f.kind === "plan" || f.kind === "drawing") && f.size <= GRID_PLAN_COPY_MAX_BYTES)
      .sort((a, b) => b.addedAt - a.addedAt);
    for (const f of files) {
      out.push({
        id: `pf:${f.id}`,
        source: "estimate",
        from: `${input.quoteNumber} · Plans & risers`,
        name: f.name,
        sizeLabel: formatBytes(f.size),
        blobPath: f.blobPath,
        size: f.size,
        mime: f.contentType,
      });
    }
  }
  const cats = input.categories || [];
  const planKeys = new Set(cats.filter(isPlanCategory).map((c) => c.key));
  const labelOf = (key: string) => cats.find((c) => c.key === key)?.label || "Files";
  const site = (input.siteLocId || "").trim();
  const docs = [...(input.documents || [])]
    .filter((d) => d && !d.deleted && typeof d.blobPath === "string" && d.blobPath && typeof d.id === "string")
    .filter((d) => planKeys.has(d.category || ""))
    .filter((d) => !d.siteId || (!!site && d.siteId === site))
    .filter((d) => looksLikePlanFile(d.mime || "", d.fileName || ""))
    .filter((d) => typeof d.size === "number" && d.size > 0 && d.size <= GRID_PLAN_COPY_MAX_BYTES)
    .sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
  for (const d of docs) {
    out.push({
      id: `doc:${d.id}`,
      source: "documents",
      from: `Company files · ${labelOf(d.category || "")}`,
      name: d.fileName || d.title || "Plan",
      sizeLabel: formatBytes(d.size || 0),
      blobPath: d.blobPath as string,
      size: d.size as number,
      mime: d.mime || "",
    });
  }
  return out.slice(0, GRID_PLAN_MAX_CANDIDATES);
}

/** What a client may see of a candidate (no blob path). */
export function publicPlanCandidates(list: readonly PlanCandidateFile[]): PlanCandidate[] {
  return list.map(({ id, source, from, name, sizeLabel }) => ({ id, source, from, name, sizeLabel }));
}

/** The copy's check on the source bytes: what they really are (magic bytes) and the stored size. */
export function planCopyVerdict(head: Uint8Array, size: number): { ok: true; type: PackageFileType } | { ok: false; error: string } {
  if (!(size > 0) || size > GRID_PLAN_COPY_MAX_BYTES) return { ok: false, error: size > 0 ? GRID_PLAN_COPY.tooBig : GRID_PLAN_COPY.gone };
  const type = sniffPackageFile(head);
  if (!type || !(PACKAGE_FILE_TYPES as readonly string[]).includes(type) || sheetMimeVerdict(type) !== "ok") return { ok: false, error: GRID_PLAN_COPY.wrongType };
  return { ok: true, type };
}

/* ------------------------------ intake notices ------------------------------ */

/**
 * A warning the intake save leaves for the editor (#314 review): the save
 * re-renders the route, the intake unmounts and the editor takes over, so a
 * warning held in the intake's own state was never seen. Notices live on the
 * project (`intake.notices`) until Retry succeeds or the designer dismisses
 * them. `retry`: copy = re-run the on-file plan copy; upload = pick the file
 * again (a dropped File doesn't survive the swap).
 */
export type GridIntakeNotice = {
  id: string;
  message: string;
  retry?: { kind: "copy"; candidateId: string } | { kind: "upload" };
  at: number;
};

export const MAX_INTAKE_NOTICES = 5;
export const INTAKE_NOTICE_MAX_CHARS = 600;
const NOTICE_ID_RE = /^ntc-[0-9a-z]{4,24}$/;
const CANDIDATE_ID_RE = /^(pf:PF-[0-9a-f]{12}|doc:[A-Za-z0-9_-]{1,64})$/;
const UPLOAD_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function newNoticeId(): string {
  return "ntc-" + globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export function isPlanCandidateId(v: unknown): v is string {
  return typeof v === "string" && CANDIDATE_ID_RE.test(v);
}

export function isPlanUploadId(v: unknown): v is string {
  return typeof v === "string" && UPLOAD_ID_RE.test(v);
}

/** Notice text: control characters out, trimmed, capped. */
export function cleanNoticeText(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, INTAKE_NOTICE_MAX_CHARS) : "";
}

/** Every read of stored notices: junk and duplicate ids dropped, text capped, the newest 5 kept. */
export function cleanIntakeNotices(raw: unknown): GridIntakeNotice[] {
  if (!Array.isArray(raw)) return [];
  const out: GridIntakeNotice[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (typeof o.id !== "string" || !NOTICE_ID_RE.test(o.id) || seen.has(o.id)) continue;
    const message = cleanNoticeText(o.message);
    if (!message) continue;
    const r = o.retry && typeof o.retry === "object" ? (o.retry as Record<string, unknown>) : null;
    const retry: GridIntakeNotice["retry"] =
      r && r.kind === "copy" && isPlanCandidateId(r.candidateId) ? { kind: "copy", candidateId: r.candidateId } : r && r.kind === "upload" ? { kind: "upload" } : undefined;
    seen.add(o.id);
    const at = Number(o.at);
    out.push({ id: o.id, message, ...(retry ? { retry } : {}), at: Number.isFinite(at) ? at : 0 });
  }
  return out.slice(-MAX_INTAKE_NOTICES);
}

/** The intake plan view's source key — what makes a retried copy / upload a no-op (#314 review). */
export function planSourceKey(kind: "copy" | "upload", id: string): string {
  return `${kind}:${id}`;
}

/** The sheet a source already landed as, if it is still on the design — else null (attach it). */
export function attachedPlanSheet(
  intake: { planSource?: string; planSheetId?: string } | undefined | null,
  sheetIds: readonly string[],
  source: string
): string | null {
  return intake?.planSource === source && intake.planSheetId && sheetIds.includes(intake.planSheetId) ? intake.planSheetId : null;
}

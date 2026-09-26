import { putBlob } from "@/lib/blob";
import {
  attachDocument,
  createDocument,
  recordFetchResult,
  replaceDocumentFile,
  titleFromFileName,
} from "@/lib/stores/part-documents";
import { linkedDocuments, ownFiles } from "./coverage";
import { fetchDocumentBytes } from "./fetch";
import { checkDocumentBytes, fileNameForFetched } from "./files";
import type { PartDocsState } from "./load";
import { MAX_FETCH_TIMEOUT_MS, newDocumentId, partDocBlobPath, type PartDocKind, type PartDocument } from "./types";

/**
 * "Fetch from links" (#207, spec §3/§6). Server-only. For one part and one
 * kind: try each URL the part has but hasn't fetched — its link-only
 * documents first, then the catalog's own Datasheet/Guide Spec/DaVinci
 * URLs — download it through the SSRF guard, check the bytes, store the file
 * privately and attach it. A URL already fetched for ANY part is reused, not
 * downloaded again, and a successful (or, review fix wave 1 M2, a FAILED)
 * fetch is shared with every part that referenced the same URL AND KIND: one
 * document per (kind, URL) pair (spec §3; a datasheet URL never reuses or
 * attaches a spec-sheet document or vice versa — M1).
 *
 * A failure is recorded on the document (creating a link-only one for a
 * catalog URL that had none) so the page can list it with its reason.
 */

export type FetchTarget = { sku: string; kind: PartDocKind };
export type FetchOutcome = FetchTarget & { ok: boolean; documentId?: string; error?: string; alsoLinked?: number };

export type FetchLinksDeps = {
  fetchDoc: typeof fetchDocumentBytes;
  putFile: (pathname: string, bytes: Buffer, contentType: string) => Promise<{ pathname: string }>;
};

const liveDeps: FetchLinksDeps = { fetchDoc: fetchDocumentBytes, putFile: putBlob };

/** M1: key every per-URL lookup by kind + URL, never URL alone — otherwise a
 *  spec-sheet request for a URL some OTHER part already fetched as a
 *  datasheet would read (and on failure, even write) that datasheet's
 *  document, and `attachDocument` would link it with the wrong kind. */
function urlKey(kind: PartDocKind, url: string): string {
  return `${kind}\u0000${url}`;
}

/** Per-request lookups over one loaded state: documents by (kind, URL), and
 *  which parts reference each (kind, URL) — catalog fields or a linked
 *  document. */
export type FetchContext = {
  state: PartDocsState;
  byUrl: Map<string, PartDocument>;
  skusByUrl: Map<string, Set<string>>;
  /** M2: (kind, URL) pairs that failed a fetch attempt DURING this
   *  context's lifetime — i.e. earlier in the SAME action call, not merely
   *  loaded as already-failed from a previous call/persisted state — so a
   *  second part in this same call referencing the same broken URL reuses
   *  the failure instead of downloading it again. Keyed the same as
   *  `byUrl`; value is the error text to report. */
  failedThisCall: Map<string, string>;
};

export function buildFetchContext(state: PartDocsState): FetchContext {
  const byUrl = new Map<string, PartDocument>();
  for (const d of state.documents) {
    if (!d.sourceUrl) continue;
    const key = urlKey(d.kind, d.sourceUrl);
    const current = byUrl.get(key);
    if (!current || (!current.blobKey && d.blobKey)) byUrl.set(key, d);
  }
  const skusByUrl = new Map<string, Set<string>>();
  const add = (kind: PartDocKind, url: string, sku: string) => {
    const key = urlKey(kind, url);
    let s = skusByUrl.get(key);
    if (!s) skusByUrl.set(key, (s = new Set()));
    s.add(sku);
  };
  for (const [sku, urls] of state.index.catalogUrls) {
    for (const u of urls.datasheet) add("datasheet", u, sku);
    for (const u of urls.specsheet) add("specsheet", u, sku);
  }
  for (const l of state.links) {
    const d = state.index.docsById.get(l.documentId);
    if (d?.sourceUrl) add(d.kind, d.sourceUrl, l.partSku);
  }
  return { state, byUrl, skusByUrl, failedThisCall: new Map() };
}

function candidateUrls(ctx: FetchContext, t: FetchTarget): string[] {
  const out: string[] = [];
  for (const d of linkedDocuments(ctx.state.index, t.sku, t.kind)) if (!d.blobKey && d.sourceUrl) out.push(d.sourceUrl);
  for (const u of ctx.state.index.catalogUrls.get(t.sku)?.[t.kind] ?? []) out.push(u);
  return [...new Set(out)];
}

function urlFileName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || "") || "document";
  } catch {
    return "document";
  }
}

/** Link `doc` to `sku` plus every OTHER part (in the loaded state) that
 *  references the same (kind, URL) pair — success sharing (spec §3) and, as
 *  of M2, failure sharing too, via the same helper. */
async function shareWith(ctx: FetchContext, doc: PartDocument, sku: string, by: string): Promise<number> {
  const key = urlKey(doc.kind, doc.sourceUrl || "");
  const skus = new Set([sku, ...(ctx.skusByUrl.get(key) ?? [])]);
  return attachDocument(doc.id, [...skus], by);
}

/* ---------------- I1: the per-call wall-clock budget ---------------- */

/** Fixed text for a target a batch ran out of time to even start. */
export const NOT_ATTEMPTED_ERROR = "Not attempted — run again.";

/** One fetch attempt's worst case for "is there room to start another one" —
 *  the fetcher's own timeout ceiling, not whatever time happens to be left
 *  (mirrors src/lib/geo-backfill.ts's `worstCasePerQuery`: a check against
 *  the ceiling can never let the call overrun by more than time already
 *  spent). Exported so callers reason about it the same way this module
 *  does. */
export const FETCH_WORST_CASE_MS = MAX_FETCH_TIMEOUT_MS;

/**
 * A budget shared across every `fetchSlot` call in one `fetchLinksAction`
 * invocation (I1). `now` is injectable so the deadline logic is testable
 * with a fake clock — production passes nothing and gets `Date.now`.
 * `attempted` is mutable and shared: it lets the very FIRST fetch attempt of
 * the whole call always run, even when `budgetMs` itself is smaller than one
 * fetch's worst case, guaranteeing forward progress (same bypass
 * `backfillVenueCoords`'s `done === 0` check uses) — every later attempt,
 * whether it's a new target's first URL or a fallback URL within one
 * target's own candidate list, only starts when the budget has room for a
 * full worst-case fetch.
 */
export type FetchBudget = {
  now: () => number;
  deadline: number;
  attempted: { count: number };
};

export function createFetchBudget(budgetMs: number, now: () => number = Date.now): FetchBudget {
  return { now, deadline: now() + budgetMs, attempted: { count: 0 } };
}

function remainingMs(budget: FetchBudget | undefined): number {
  return budget ? budget.deadline - budget.now() : Infinity;
}

/* ---------------- the fetch-and-share step ---------------- */

export async function fetchSlot(ctx: FetchContext, t: FetchTarget, by: string, deps: FetchLinksDeps = liveDeps, budget?: FetchBudget): Promise<FetchOutcome> {
  if (ownFiles(ctx.state.index, t.sku, t.kind).length) return { ...t, ok: true };
  const urls = candidateUrls(ctx, t);
  if (!urls.length) return { ...t, ok: false, error: "No link to fetch." };

  let lastError = "Fetch failed.";
  let attemptedForThisSlot = false;
  for (const url of urls) {
    const key = urlKey(t.kind, url);
    const found = ctx.byUrl.get(key);

    try {
      if (found?.blobKey) {
        const alsoLinked = await shareWith(ctx, found, t.sku, by);
        return { ...t, ok: true, documentId: found.id, alsoLinked };
      }

      // M2: this exact (kind, URL) already failed earlier in THIS call —
      // don't download it again. The failure was already shared with every
      // referencing part when it was first recorded (below); this just
      // covers a part `buildFetchContext` didn't already know references
      // it, and reports the same reason.
      const priorFailure = ctx.failedThisCall.get(key);
      if (priorFailure != null) {
        if (found) await shareWith(ctx, found, t.sku, by);
        lastError = priorFailure;
        continue;
      }
    } catch {
      return { ...t, ok: false, error: "Could not store the file." };
    }

    // I1: stop STARTING a new fetch attempt — whether this is the first URL
    // of a fresh slot or a fallback URL within this same slot — once the
    // budget no longer has room for one worst-case fetch. The very first
    // attempt of the whole call is exempt (see FetchBudget above). A slot
    // that got zero attempts reports the fixed "not attempted" text; a slot
    // that already tried at least one URL keeps whatever real error it has.
    if (budget) {
      const remaining = remainingMs(budget);
      if (budget.attempted.count > 0 && remaining < FETCH_WORST_CASE_MS) {
        if (!attemptedForThisSlot) return { ...t, ok: false, error: NOT_ATTEMPTED_ERROR };
        break;
      }
    }
    const timeoutMs = budget ? Math.max(1000, Math.min(FETCH_WORST_CASE_MS, remainingMs(budget))) : undefined;
    if (budget) budget.attempted.count++;
    attemptedForThisSlot = true;

    const got = await deps.fetchDoc(url, timeoutMs != null ? { timeoutMs } : undefined);
    const check = got.ok ? checkDocumentBytes(t.kind, got.file.bytes) : null;
    if (!got.ok || !check?.ok) {
      lastError = !got.ok ? got.error : check && !check.ok ? check.error : lastError;
      try {
        let failed: PartDocument | null = found ?? null;
        if (!failed) {
          failed = await createDocument({
            kind: t.kind,
            fileName: urlFileName(url),
            // M8: a placeholder for a URL that has never actually been
            // fetched successfully has no real content type to claim — in
            // particular a failed SPEC SHEET must never carry
            // "application/pdf" (PartDocument.contentType is a required
            // string, so the "no file yet" value is "", not a PDF guess).
            contentType: "",
            size: 0,
            blobKey: null,
            sourceUrl: url,
            source: "fetch",
            by,
          });
          if (failed) ctx.byUrl.set(key, failed);
        }
        if (failed) {
          await recordFetchResult(failed.id, { ok: false, error: lastError });
          // M2: share the failed link-only document with every part that
          // references this (kind, URL) — same helper success uses below.
          await shareWith(ctx, failed, t.sku, by);
          ctx.failedThisCall.set(key, lastError);
        }
      } catch {
        return { ...t, ok: false, error: "Could not store the file." };
      }
      continue;
    }

    try {
      const docId = found?.id ?? newDocumentId();
      const fileName = fileNameForFetched(got.file.contentDisposition, got.file.finalUrl, found?.title || urlFileName(url), check.type);
      const stored = await deps.putFile(partDocBlobPath(docId, fileName), Buffer.from(got.file.bytes), check.contentType);
      const file = { blobKey: stored.pathname, fileName, contentType: check.contentType, size: got.file.bytes.byteLength };
      const doc = found
        ? await replaceDocumentFile(found.id, file, by)
        : await createDocument({ id: docId, kind: t.kind, title: titleFromFileName(fileName), ...file, sourceUrl: url, source: "fetch", by });
      if (!doc) return { ...t, ok: false, error: "Could not record the document." };
      await recordFetchResult(doc.id, { ok: true });
      ctx.byUrl.set(key, doc);
      ctx.failedThisCall.delete(key);
      const alsoLinked = await shareWith(ctx, doc, t.sku, by);
      return { ...t, ok: true, documentId: doc.id, alsoLinked };
    } catch {
      return { ...t, ok: false, error: "Could not store the file." };
    }
  }
  return { ...t, ok: false, error: lastError };
}

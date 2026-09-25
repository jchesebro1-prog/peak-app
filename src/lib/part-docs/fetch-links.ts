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
import { newDocumentId, partDocBlobPath, type PartDocKind, type PartDocument } from "./types";

/**
 * "Fetch from links" (#DOC, spec §3/§6). Server-only. For one part and one
 * kind: try each URL the part has but hasn't fetched — its link-only
 * documents first, then the catalog's own Datasheet/Guide Spec/DaVinci
 * URLs — download it through the SSRF guard, check the bytes, store the file
 * privately and attach it. A URL already fetched for ANY part is reused, not
 * downloaded again, and a successful fetch is attached to every part that
 * referenced the same URL: one document per URL (spec §3).
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

/** Per-request lookups over one loaded state: documents by URL, and which
 *  parts reference each URL (catalog fields or a linked document). */
export type FetchContext = {
  state: PartDocsState;
  byUrl: Map<string, PartDocument>;
  skusByUrl: Map<string, Set<string>>;
};

export function buildFetchContext(state: PartDocsState): FetchContext {
  const byUrl = new Map<string, PartDocument>();
  for (const d of state.documents) {
    if (!d.sourceUrl) continue;
    const current = byUrl.get(d.sourceUrl);
    if (!current || (!current.blobKey && d.blobKey)) byUrl.set(d.sourceUrl, d);
  }
  const skusByUrl = new Map<string, Set<string>>();
  const add = (url: string, sku: string) => {
    let s = skusByUrl.get(url);
    if (!s) skusByUrl.set(url, (s = new Set()));
    s.add(sku);
  };
  for (const [sku, urls] of state.index.catalogUrls) for (const u of [...urls.datasheet, ...urls.specsheet]) add(u, sku);
  for (const l of state.links) {
    const d = state.index.docsById.get(l.documentId);
    if (d?.sourceUrl) add(d.sourceUrl, l.partSku);
  }
  return { state, byUrl, skusByUrl };
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

async function shareWith(ctx: FetchContext, doc: PartDocument, sku: string, by: string): Promise<number> {
  const skus = new Set([sku, ...(ctx.skusByUrl.get(doc.sourceUrl || "") ?? [])]);
  return attachDocument(doc.id, [...skus], by);
}

export async function fetchSlot(ctx: FetchContext, t: FetchTarget, by: string, deps: FetchLinksDeps = liveDeps): Promise<FetchOutcome> {
  if (ownFiles(ctx.state.index, t.sku, t.kind).length) return { ...t, ok: true };
  const urls = candidateUrls(ctx, t);
  if (!urls.length) return { ...t, ok: false, error: "No link to fetch." };

  let lastError = "Fetch failed.";
  for (const url of urls) {
    const found = ctx.byUrl.get(url);
    const existing = found && found.kind === t.kind ? found : null;
    if (existing?.blobKey) {
      const alsoLinked = await shareWith(ctx, existing, t.sku, by);
      return { ...t, ok: true, documentId: existing.id, alsoLinked };
    }

    const got = await deps.fetchDoc(url);
    const check = got.ok ? checkDocumentBytes(t.kind, got.file.bytes) : null;
    if (!got.ok || !check?.ok) {
      lastError = !got.ok ? got.error : check && !check.ok ? check.error : lastError;
      let failed = existing;
      if (!failed) {
        failed = await createDocument({
          kind: t.kind,
          fileName: urlFileName(url),
          contentType: "application/pdf",
          size: 0,
          blobKey: null,
          sourceUrl: url,
          source: "fetch",
          by,
        });
        if (failed) {
          await attachDocument(failed.id, [t.sku], by);
          ctx.byUrl.set(url, failed);
        }
      }
      if (failed) await recordFetchResult(failed.id, { ok: false, error: lastError });
      continue;
    }

    const docId = existing?.id ?? newDocumentId();
    const fileName = fileNameForFetched(got.file.contentDisposition, got.file.finalUrl, existing?.title || urlFileName(url), check.type);
    const stored = await deps.putFile(partDocBlobPath(docId, fileName), Buffer.from(got.file.bytes), check.contentType);
    const file = { blobKey: stored.pathname, fileName, contentType: check.contentType, size: got.file.bytes.byteLength };
    const doc = existing
      ? await replaceDocumentFile(existing.id, file, by)
      : await createDocument({ id: docId, kind: t.kind, title: titleFromFileName(fileName), ...file, sourceUrl: url, source: "fetch", by });
    if (!doc) return { ...t, ok: false, error: "Could not record the document." };
    await recordFetchResult(doc.id, { ok: true });
    ctx.byUrl.set(url, doc);
    const alsoLinked = await shareWith(ctx, doc, t.sku, by);
    return { ...t, ok: true, documentId: doc.id, alsoLinked };
  }
  return { ...t, ok: false, error: lastError };
}

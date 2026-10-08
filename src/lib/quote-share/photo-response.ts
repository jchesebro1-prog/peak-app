import { createHash } from "node:crypto";
import { getBlobStream } from "@/lib/blob";
import { keyProductPhotoDocs, PHOTO_TYPES } from "@/lib/narrative/photos";
import { packagePhotoSections } from "@/lib/estimate-output/package-model";
import type { QuoteRevision } from "@/lib/stores/quotes";
import type { SpecSection } from "@/app/(app)/estimator/types";
import type { PartDocument } from "@/lib/part-docs/types";
import { normalizeSystemOrder, sanitizeGroups, type SystemGroup } from "@/lib/estimate-groups/groups";
import { sanitizePackageDoc } from "@/lib/package-doc/sanitize";
import type { PackageDoc } from "@/lib/package-doc/types";

/**
 * #293 slice 3 (spec §5.4) — the online pages' photos. Both photo routes
 * recompute, live, the photo docs the quote's latest SENT revision prints
 * (keyProductPhotoDocs over that revision's sections: narrative systems'
 * resolved, photo-on blocks of live parts) and serve only a member — PNG,
 * JPEG or WebP, nosniff, private 1 h, an ETag on doc id + blobKey hash (the
 * portal doc route's scheme). Anything else is a plain 404. Read-only.
 * #301 slice B: the v2 package page serves a wider set
 * (packagePhotoDocForRevision); both go through serveDoc.
 */

export const ONLINE_PHOTO_CACHE = "private, max-age=3600";

export function revisionSections(rev: QuoteRevision): SpecSection[] {
  const spec = rev.spec as { sections?: unknown } | null | undefined;
  return spec && Array.isArray(spec.sections) ? (spec.sections as SpecSection[]) : [];
}

/** Estimator Phase 5 — the revision's package document (sanitized; null = none). */
export function revisionDocument(rev: QuoteRevision): PackageDoc | null {
  const spec = rev.spec as { document?: unknown } | null | undefined;
  return sanitizePackageDoc(spec ? spec.document : undefined);
}

/** Estimator Phase 2b — the revision's systems as the customer document
 *  prints them (normalised + alternate-stamped against its own groups, as
 *  quoteDocumentDataFor does), with those groups: the scope picker's input. */
export function revisionGroupedSections(rev: QuoteRevision): { sections: SpecSection[]; groups: SystemGroup[] } {
  const spec = rev.spec as { groups?: unknown } | null | undefined;
  const groups = sanitizeGroups(spec ? spec.groups : undefined);
  return { sections: normalizeSystemOrder(revisionSections(rev), groups), groups };
}

export async function photoDocForRevision(rev: QuoteRevision, docId: string): Promise<PartDocument | null> {
  if (typeof docId !== "string" || !docId) return null;
  // Phase 5: the package document's photo-on product blocks are servable too.
  // Alternates are told apart on the normalised, group-stamped systems — the
  // ones the customer document printed (quoteDocumentDataFor) — not raw spec.
  const docs = await keyProductPhotoDocs(revisionGroupedSections(rev).sections, revisionDocument(rev));
  for (const d of docs.values()) if (d.id === docId) return d;
  return null;
}

/** #301 slice B — the package page's photo set: every printed system's key
 *  products, whatever its presentation (package-model.ts packagePhotoSections). */
export async function packagePhotoDocForRevision(rev: QuoteRevision, docId: string): Promise<PartDocument | null> {
  if (typeof docId !== "string" || !docId) return null;
  const docs = await keyProductPhotoDocs(packagePhotoSections(revisionGroupedSections(rev).sections), revisionDocument(rev));
  for (const d of docs.values()) if (d.id === docId) return d;
  return null;
}

/** A fresh Response per call — a body can be read only once. */
const notFound = () => new Response("Not found", { status: 404 });

async function serveDoc(req: Request, doc: PartDocument | null): Promise<Response> {
  if (!doc || !doc.blobKey || !PHOTO_TYPES.has(doc.contentType)) return notFound();
  const etag = `"${doc.id}-${createHash("sha1").update(doc.blobKey).digest("hex").slice(0, 16)}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag, "cache-control": ONLINE_PHOTO_CACHE } });
  }
  let stream: ReadableStream | null;
  try {
    stream = await getBlobStream(doc.blobKey);
  } catch {
    // Never surface the vendor's own error text to the browser.
    return new Response("Couldn't read the file — try again", { status: 502 });
  }
  if (!stream) return notFound();
  return new Response(stream, {
    headers: {
      "content-type": doc.contentType,
      "cache-control": ONLINE_PHOTO_CACHE,
      etag,
      "x-content-type-options": "nosniff",
    },
  });
}

export async function servePhotoForRevision(req: Request, rev: QuoteRevision, docId: string): Promise<Response> {
  return serveDoc(req, await photoDocForRevision(rev, docId));
}

export async function servePackagePhotoForRevision(req: Request, rev: QuoteRevision, docId: string): Promise<Response> {
  return serveDoc(req, await packagePhotoDocForRevision(rev, docId));
}

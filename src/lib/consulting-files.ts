/**
 * Engagement file seam (#145, D171). One union resolved at write time by
 * what is configured: Drive when the archive mailbox is connected, Blob
 * when BLOB_READ_WRITE_TOKEN is set, data-URL locally (Vercel Blob refuses
 * local dev uploads under OIDC — see PUNCHLIST #143).
 *
 * Pure: no imports, so the ownership check is spec-tested with no DB.
 */

export type FileMeta = { name: string; mime: string; size: number };
export type FileRef =
  | ({ kind: "drive"; fileId: string; webViewLink: string } & FileMeta)
  | ({ kind: "blob"; pathname: string } & FileMeta)
  | ({ kind: "data"; dataUrl: string } & FileMeta);

export function fileRefName(ref: FileRef): string {
  return ref.name;
}

/** The storage key a proxy would stream by — the value the ownership check
 *  compares against. A data-URL ref has no key: its bytes are in the doc. */
export function fileRefKey(ref: FileRef): string {
  if (ref.kind === "drive") return ref.fileId;
  if (ref.kind === "blob") return ref.pathname;
  return "";
}

/**
 * THE ownership check (mirrors ownsVendorQuoteBlobPath). A client names a
 * file id; this proves that id is actually stored on the engagement being
 * requested. Without it the authenticated proxy is an arbitrary-read
 * primitive over the whole private store.
 */
export function ownsEngagementFile(refs: readonly FileRef[], requestedKey: string): boolean {
  if (!requestedKey) return false;
  return refs.some((r) => {
    const k = fileRefKey(r);
    return !!k && k === requestedKey;
  });
}

/** Drive folder path for an engagement. Separators in a customer name are
 *  replaced, never honoured — a name is data, not a path. */
export function engagementFolderPath(customer: string, engagementId: string): string {
  const safe = String(customer || "Unknown")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `Peak Projects/${safe}/${engagementId}`;
}

/**
 * The URL a client renders as this file's link/download target.
 *
 * A "data" ref has no storage key (fileRefKey returns "") — its bytes
 * already live in the document, so the dataUrl itself IS the href and no
 * network round trip is needed. "drive" and "blob" refs both route through
 * this app's own authenticated, ownership-checked proxy rather than a raw
 * Drive webViewLink: the file was created by the app's own Drive
 * connection (scope drive.file), so a teammate's browser has no standing
 * Google-side access to it, and the proxy is the only path that has
 * already proven the id belongs to this engagement before it streams
 * anything.
 */
export function fileRefHref(ref: FileRef, engagementId: string): string {
  if (ref.kind === "data") return ref.dataUrl;
  return `/api/engagement-files/${encodeURIComponent(engagementId)}/${encodeURIComponent(fileRefKey(ref))}`;
}

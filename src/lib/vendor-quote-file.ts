/**
 * Vendor-quote attachment rules (#143) — the storage prefix, the upload
 * ceiling, and the question "may this record claim this stored path?".
 *
 * Shared deliberately by all four places that touch a vendor-quote file: the
 * upload route, the save action, the download proxy and the estimator form.
 * The cap the form advertises and the cap the route enforces drifting apart
 * is how a user ends up reading a refusal that names the wrong reason.
 *
 * Pure, with no server imports: the estimator's modal is a client component
 * and src/lib/blob.ts (which holds the token) must never reach that bundle.
 */

/** Every vendor-quote file lives under this prefix, and nothing else does. */
export const VENDOR_QUOTE_BLOB_PREFIX = "vendor-quotes/";

/**
 * Largest file the upload route accepts (#143 re-review).
 *
 * Not the 10 MB a route handler could otherwise swallow: Vercel Functions —
 * the deploy target (DEPLOY.md) — reject a request body over ~4.5 MB before
 * the handler runs, so a larger cap would be a promise the host overrides and
 * the browser would get a platform error in place of this route's JSON. 4 MB
 * leaves room for the multipart envelope.
 *
 * A genuinely bigger file needs the client-upload broker the recordings
 * module already uses (`handleUpload` from @vercel/blob/client, see
 * src/app/api/recordings/upload/route.ts), whose bytes never traverse a
 * function. Until Jeff asks for it, the Link field is the escape hatch.
 */
export const VENDOR_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** The same ceiling as the form's label and the route's refusal read it. */
export const VENDOR_UPLOAD_MAX_LABEL = "4 MB";

/**
 * May this vendor quote be served from this stored path?
 *
 * `blobPath` reaches the server from the BROWSER now (the upload route hands
 * it back and it rides along in the save payload), so it is untrusted input:
 * unchecked, a crafted save would point a vendor quote at any object in the
 * private Blob store — meeting audio, grid plan sheets, another customer's
 * quote — and the authenticated download proxy would happily stream it.
 *
 * The path is therefore bound to the record: it must sit under the
 * vendor-quote prefix and its filename must start with this record's own id,
 * which is the shape both writers mint —
 *   upload route: vendor-quotes/<vqId>-<file>
 *   save action:  vendor-quotes/<quoteId>/<vqId>-<file>
 */
export function ownsVendorQuoteBlobPath(
  path: string | null | undefined,
  vendorQuoteId: string
): boolean {
  if (!path || !vendorQuoteId) return false;
  if (!path.startsWith(VENDOR_QUOTE_BLOB_PREFIX) || path.includes("..")) return false;
  const rest = path.slice(VENDOR_QUOTE_BLOB_PREFIX.length);
  const slash = rest.indexOf("/");
  const file = slash === -1 ? rest : rest.slice(slash + 1);
  // One optional grouping segment, never a deeper walk into the store.
  if (file.includes("/")) return false;
  return file.startsWith(vendorQuoteId + "-");
}

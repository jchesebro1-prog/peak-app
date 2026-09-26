/**
 * Plan-sheet upload rules (#146) — the storage prefix, the upload ceiling and
 * the accepted file types for a Grid plan sheet.
 *
 * Shared deliberately by the upload route and the editor's file picker: the
 * cap the UI advertises and the cap the route enforces drifting apart is how a
 * user ends up reading a refusal that names the wrong reason. That is exactly
 * what #146 was — the action promised 8 MB while the platform allowed ~900 kB.
 *
 * Pure, with no server imports: the editor is a client component and
 * src/lib/blob.ts (which holds the Blob token) must never reach that bundle.
 * Same split, and for the same reason, as src/lib/vendor-quote-file.ts (#143).
 */

/** Every uploaded plan sheet lives under this prefix. */
export const GRID_SHEET_BLOB_PREFIX = "grid-sheets/";

/**
 * Largest plan sheet the upload route accepts.
 *
 * NOT the 8 MB the old server action claimed. Two ceilings sit under this
 * number and the smaller one wins:
 *
 *  - `next.config.ts` caps a server-action body at 1200kb, and base64 inflates
 *    by 4/3, so the action's real limit was a ~900 kB file — and going over it
 *    got the whole REQUEST rejected by Next before the action ran, so the
 *    refusal arrived as an unhandled rejection instead of the action's own
 *    message. Route handlers are not bound by that cap, which is why the
 *    upload is a route now.
 *  - Vercel Functions — the deploy target (DEPLOY.md) — reject a request body
 *    over ~4.5 MB before the handler runs. A larger cap here would be a
 *    promise the host overrides, and the browser would get a platform error in
 *    place of this route's JSON: #146 again, one layer up. 4 MB leaves room
 *    for the multipart envelope.
 *
 * A genuinely bigger sheet needs the client-upload broker the recordings
 * module already uses (`handleUpload` from @vercel/blob/client, see
 * src/app/api/recordings/upload/route.ts), whose bytes never traverse a
 * function. That is a real upgrade path, not a workaround — see D173 for why
 * it was not taken here — and it is Jeff-gated.
 */
export const GRID_SHEET_MAX_BYTES = 4 * 1024 * 1024;

/** The same ceiling as the picker's label and the route's refusal read it. */
export const GRID_SHEET_MAX_LABEL = "4 MB";

/**
 * May a file of this type be stored as a plan sheet?
 *
 * PDFs and raster images, and deliberately NOT SVG. The sheet proxy
 * (/api/grid-sheets/<id>) streams a sheet INLINE under its stored mime with no
 * content-disposition — it has to, the editor paints it as a canvas
 * background — so an `image/svg+xml` sheet opened top-level would execute its
 * own script in the app's origin against the signed-in session. The vendor
 * quote proxy escapes this by forcing `attachment`; a background image cannot.
 */
export function isAllowedSheetMime(mime: string): boolean {
  return sheetMimeVerdict(mime) === "ok";
}

/** Why a type was refused, so the route can say which of the two it was
 *  instead of telling someone who picked an SVG to "print DWGs to PDF". */
export function sheetMimeVerdict(mime: string): "ok" | "svg" | "other" {
  const m = (mime || "").toLowerCase().split(";")[0].trim();
  if (m === "application/pdf") return "ok";
  if (m === "image/svg+xml" || m === "image/svg") return "svg";
  return m.startsWith("image/") ? "ok" : "other";
}

/**
 * Decode an in-database sheet's data-URL (`data:<mime>[;params][;base64],…`)
 * so the sheet proxy can stream it like a Blob sheet (#209 final review I6 —
 * the drawing set loads every sheet by URL, once, instead of inlining the
 * data-URL into each plan page). Null for anything that isn't a data-URL.
 */
export function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const meta = dataUrl.slice(5, comma).split(";");
  const mime = (meta[0] || "application/octet-stream").trim().toLowerCase();
  const base64 = meta.slice(1).some((m) => m.trim().toLowerCase() === "base64");
  const payload = dataUrl.slice(comma + 1);
  try {
    // atob/TextEncoder, not Buffer: this module stays platform-neutral (the
    // editor, a client component, imports it for the size constants).
    const bytes = base64 ? Uint8Array.from(atob(payload.replace(/\s+/g, "")), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(payload));
    return { mime, bytes };
  } catch {
    return null;
  }
}

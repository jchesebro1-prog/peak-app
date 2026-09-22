import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { blobEnabled, putBlob, safeName } from "@/lib/blob";
import {
  VENDOR_QUOTE_BLOB_PREFIX,
  VENDOR_UPLOAD_MAX_BYTES,
  VENDOR_UPLOAD_MAX_LABEL,
} from "@/lib/vendor-quote-file";

/**
 * Vendor-quote attachment upload (#143). Shape copied from
 * /api/import/xlsx — multipart in, NextResponse.json out.
 *
 * Why a route at all: the estimator used to carry the file to the server as a
 * base64 data-URL inside `saveQuoteAction`'s payload, and next.config.ts caps
 * a server-action body at 1200 kb — so with base64's 4/3 inflation the whole
 * ESTIMATE could only ever hold ~600 kB of quote files, while a real vendor
 * PDF is 1–5 MB. Route handlers are not bound by that cap, so when Blob
 * storage is on the bytes never touch the save payload: the browser posts the
 * file here on selection and the record carries only `blobPath`.
 *
 * With no BLOB_READ_WRITE_TOKEN this returns 503 and the client falls back to
 * the data-URL + VENDOR_ATTACHMENT_BUDGET path, which stays the no-Blob
 * behaviour exactly as it was.
 *
 * Auth is requireUser(), matching the sibling GET proxy — any estimator must
 * be able to attach a vendor quote, so NOT the manage_users gate the import
 * route carries.
 *
 * The ceiling is VENDOR_UPLOAD_MAX_BYTES, not the 10 MB a route handler
 * could otherwise take: on Vercel a body over ~4.5 MB never reaches this
 * function at all (#143 re-review — see the constant for the reasoning and
 * the client-upload broker that lifts it).
 */

// A single file in, then a Blob write — nowhere near this, but a slow uplink
// must not have the function expire while the body is still arriving.
export const maxDuration = 60;

/** The client's vendor-quote id shape: "vq" + base36 time + base36 random.
 *  It lands in a storage path, so it is validated, never sanitized-and-used. */
const VQ_ID = /^vq[a-z0-9]{4,32}$/;

const tooBig = () =>
  `That file is larger than ${VENDOR_UPLOAD_MAX_LABEL}. Attach a smaller PDF, or paste a Link instead.`;

export async function POST(req: Request): Promise<NextResponse> {
  await requireUser();

  if (!blobEnabled()) {
    return NextResponse.json(
      { ok: false, error: "Blob storage is not configured on this server." },
      { status: 503 }
    );
  }

  /* Refuse on the declared length BEFORE req.formData() materializes the
     whole multipart body in memory (#143 re-review): the file.size check
     below limits what gets STORED, not what gets READ. A header can be absent
     or lie, so that check stays the authoritative one. */
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > VENDOR_UPLOAD_MAX_BYTES + 64 * 1024) {
    return NextResponse.json(
      { ok: false, error: tooBig() },
      { status: 413 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a file upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No file was attached." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "That file is empty." }, { status: 400 });
  }
  if (file.size > VENDOR_UPLOAD_MAX_BYTES) {
    return NextResponse.json({ ok: false, error: tooBig() }, { status: 413 });
  }

  const vendorQuoteId = String(form.get("vendorQuoteId") || "");
  if (!VQ_ID.test(vendorQuoteId)) {
    return NextResponse.json({ ok: false, error: "Bad vendor quote id." }, { status: 400 });
  }

  /* Deliberately NOT keyed by quote id: an unsaved estimate has no id yet, and
     the GET proxy streams by `attachment.blobPath` alone, so the quote id was
     never needed to read the file back. */
  const mime = file.type || "application/octet-stream";
  const bytes = Buffer.from(await file.arrayBuffer());
  let stored: { pathname: string };
  try {
    stored = await putBlob(
      `${VENDOR_QUOTE_BLOB_PREFIX}${vendorQuoteId}-${safeName(file.name || "quote")}`,
      bytes,
      mime
    );
  } catch (e) {
    console.error("[vendor-quote-attachments] upload failed:", e);
    return NextResponse.json(
      { ok: false, error: "That file could not be stored." },
      { status: 502 }
    );
  }

  // putBlob adds a random suffix, so the RETURNED pathname is the only one
  // that resolves — never echo back the path we asked for.
  return NextResponse.json({ ok: true, blobPath: stored.pathname, name: file.name, mime });
}

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { blobEnabled, putBlob, safeName } from "@/lib/blob";
import { addSheet, getProject, recordIntakePlan } from "@/lib/stores/grid-projects";
import { withPlanLock } from "@/lib/design/grid-plan-intake-server";
import { attachedPlanSheet, isPlanUploadId, planSourceKey } from "@/lib/design/grid-plan-intake";
import {
  GRID_SHEET_BLOB_PREFIX,
  GRID_SHEET_MAX_BYTES,
  GRID_SHEET_MAX_LABEL,
  sheetMimeVerdict,
} from "@/lib/grid-sheet-file";

/**
 * Plan-sheet upload (#146, D173). Shape copied from
 * /api/vendor-quote-attachments/upload (#143) — multipart in,
 * NextResponse.json out.
 *
 * Why a route and not the server action it replaces: `addSheetAction` took the
 * sheet as a base64 data-URL inside its payload and advertised an 8 MB
 * ceiling, but next.config.ts caps a server-action body at 1200kb and base64
 * inflates by 4/3 — so the real limit was a ~900 kB file, and anything larger
 * had its whole request body rejected by Next BEFORE the action ran. The user
 * got an unhandled rejection rather than the action's careful error message.
 * Route handlers are not bound by that cap.
 *
 * Unlike the vendor-quote route this does the WHOLE job — bytes to storage and
 * the `grid_sheets` doc written here — and returns only the new sheet id. That
 * is the deliberate difference (D173): a vendor quote hangs off an estimate
 * that may not be saved yet, so its `blobPath` has to round-trip through the
 * browser and be re-validated on the way back (ownsVendorQuoteBlobPath). A
 * plan sheet belongs to a project that already exists, so the path never
 * leaves the server and there is no untrusted `blobPath` to guard: the sheet
 * proxy (/api/grid-sheets/<id>) keeps reading a value only this route wrote.
 *
 * Auth is requireUser(), matching both the old action and the sibling GET
 * proxy — any designer may add a sheet to a design they can open.
 *
 * Route resolution note: this static `upload` segment sits beside the dynamic
 * `[id]` proxy. Next resolves static before dynamic, and sheet ids are minted
 * `gs-<hex>`, so the two can never collide.
 */

// One file in, then a Blob write — nowhere near this, but a slow uplink on a
// venue's wifi must not have the function expire while the body is arriving.
export const maxDuration = 60;

const tooBig = () =>
  `That file is larger than ${GRID_SHEET_MAX_LABEL}. Print the drawing to a smaller PDF (one sheet per file) and try again.`;

export async function POST(req: Request): Promise<NextResponse> {
  const user = await requireUser();

  /* Refuse on the declared length BEFORE req.formData() materializes the whole
     multipart body in memory (the #143 re-review lesson): the file.size check
     below limits what gets STORED, not what gets READ. A header can be absent
     or lie, so that check stays the authoritative one. */
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > GRID_SHEET_MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ ok: false, error: tooBig() }, { status: 413 });
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
  if (file.size > GRID_SHEET_MAX_BYTES) {
    return NextResponse.json({ ok: false, error: tooBig() }, { status: 413 });
  }

  const mime = file.type || "application/octet-stream";
  const verdict = sheetMimeVerdict(mime);
  if (verdict !== "ok") {
    return NextResponse.json(
      {
        ok: false,
        error:
          verdict === "svg"
            ? "SVG plan sheets aren't supported — export the drawing as a PDF or PNG instead."
            : "PDF or image files only — print DWGs to PDF first.",
      },
      { status: 415 }
    );
  }

  const projectId = String(form.get("projectId") || "");
  if (!projectId || projectId.includes("/") || projectId.length > 64) {
    return NextResponse.json({ ok: false, error: "Bad design id." }, { status: 400 });
  }
  if (!(await getProject(projectId))) {
    return NextResponse.json({ ok: false, error: "Design not found." }, { status: 404 });
  }

  const name = String(form.get("name") || file.name || "Plan sheet").slice(0, 120);
  const bytes = Buffer.from(await file.arrayBuffer());
  // #314: the Grid intake's plan view asks to go FIRST (the editor opens on
  // it, in front of the generated base sheet); every other upload appends.
  // It carries an upload id, so a retry of an upload that already landed
  // (the response was lost) returns that sheet instead of adding it twice.
  const first = String(form.get("position") || "") === "first";
  const uploadId = form.get("planUploadId");
  if (first && !isPlanUploadId(uploadId)) {
    return NextResponse.json({ ok: false, error: "Bad upload id." }, { status: 400 });
  }
  if (first) {
    const source = planSourceKey("upload", uploadId as string);
    return withPlanLock(projectId, async () => {
      const now = await getProject(projectId);
      const done = now ? attachedPlanSheet(now.intake, now.sheetIds || [], source) : null;
      if (done) return NextResponse.json({ ok: true, sheetId: done, already: true });
      const r = await storeSheet(projectId, name, mime, bytes, user.name, true);
      if (r instanceof NextResponse) return r;
      await recordIntakePlan(projectId, r, source);
      revalidatePath(`/design/grid/${encodeURIComponent(projectId)}`);
      return NextResponse.json({ ok: true, sheetId: r });
    });
  }
  const r = await storeSheet(projectId, name, mime, bytes, user.name, false);
  if (r instanceof NextResponse) return r;
  revalidatePath(`/design/grid/${encodeURIComponent(projectId)}`);
  return NextResponse.json({ ok: true, sheetId: r });
}

/** Bytes to storage + the grid_sheets doc; the new sheet id, or the error response. */
async function storeSheet(projectId: string, name: string, mime: string, bytes: Buffer, by: string, first: boolean): Promise<string | NextResponse> {
  // Blob storage when the token exists (D116); in-database data-URL otherwise,
  // which is the whole dev story (AGENTS.md: `npm run dev` needs no cloud) and
  // is unchanged from the action this replaces.
  let stored: { dataUrl?: string; url?: string; blobPath?: string };
  if (blobEnabled()) {
    try {
      const up = await putBlob(
        `${GRID_SHEET_BLOB_PREFIX}${projectId}/${safeName(name)}`,
        bytes,
        mime
      );
      // putBlob adds a random suffix, so the RETURNED pathname is the only one
      // that resolves — never store the path we asked for.
      stored = { url: up.url, blobPath: up.pathname };
    } catch (e) {
      console.error("[grid] blob upload failed:", e);
      return NextResponse.json(
        { ok: false, error: "Upload to file storage failed — check the Blob token, or try again." },
        { status: 502 }
      );
    }
  } else {
    stored = { dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
  }

  const sheet = await addSheet(projectId, { name, mime, ...stored, by, ...(first ? { first: true } : {}) });
  if (!sheet) return NextResponse.json({ ok: false, error: "Design not found." }, { status: 404 });
  return sheet.id;
}

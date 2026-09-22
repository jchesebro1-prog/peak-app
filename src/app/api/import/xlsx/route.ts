import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/session";
import { xlsxToCsv } from "@/lib/import/xlsx-to-csv";
import { checkSize } from "@/lib/catalog-import-guard";

/**
 * .xlsx upload → CSV text (punch #81). Converts only; writes nothing. The
 * client drops the returned CSV into the import hub's existing textarea, so
 * preview, mapping and the authoritative re-parse in importRecords all run
 * unchanged.
 *
 * Gated on the same manage_users permission as importRecords — it must not
 * be an open file-parsing endpoint even though it persists nothing.
 *
 * Size: the `catalog` type is capped at 1 MB (punch #134, same check as the
 * Catalog page importer); every other type keeps the 10 MB cap. The client
 * posts `type` alongside the file.
 */

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request): Promise<NextResponse> {
  await requirePerm("manage_users");

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
  const type = String(form.get("type") || "");
  if (type === "catalog") {
    const size = checkSize(file.size);
    if (!size.ok) return NextResponse.json({ ok: false, error: size.error }, { status: 413 });
  } else if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "That file is larger than 10 MB. Split it, or export the sheet as CSV." },
      { status: 413 }
    );
  }

  const res = await xlsxToCsv(await file.arrayBuffer());
  if (!res.ok) return NextResponse.json(res, { status: 422 });

  return NextResponse.json(res);
}

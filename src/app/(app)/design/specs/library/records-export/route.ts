import { requireUser } from "@/lib/session";
import { allSpecRecords } from "@/lib/stores/spec-records";
import { writeLibraryWorkbook } from "@/lib/specs/record-io";

/**
 * Spec Library **Export .xlsx** (spec records design §2, §7): one
 * `Spec Library` sheet in exactly the import's column layout, so Jeff can
 * review in Excel and re-import — export → import of an unchanged file is
 * 0 changes. GET-only and read-gated (`requireUser()`); the import is a
 * create-gated server action.
 */

/** Today in Peak's own time zone (Central), as YYYY-MM-DD — "en-CA" formats
 *  dates year-first, so the server's own zone (UTC on Vercel) never shifts
 *  an evening export onto tomorrow's date. */
function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
}

export async function GET() {
  await requireUser();
  const buf = await writeLibraryWorkbook(await allSpecRecords());
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="Peak Spec Library ${today()}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}

import { requirePerm } from "@/lib/session";
import { loadCableExportRows, loadRiserExportRows, writeRiserDataSheet } from "@/lib/riser-data-sheet-server";

/** Riser data sheet **export** (#328 A2, B1): the Devices tab — every lighting-control
 *  part, blanks pre-filled by the suggestion rules — and the Cables tab — every
 *  per-length cable a wire type or Grid route uses, blank diameters pre-filled
 *  from the researched table. Admin only. */
export const maxDuration = 60;

export async function GET() {
  await requirePerm("manage_users");
  const [{ rows, types }, cableRows] = await Promise.all([loadRiserExportRows(), loadCableExportRows()]);
  const buf = await writeRiserDataSheet(rows, types, cableRows);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="Peak riser data ${day}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}

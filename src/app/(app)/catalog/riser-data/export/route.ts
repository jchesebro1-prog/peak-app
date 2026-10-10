import { requirePerm } from "@/lib/session";
import { loadRiserExportRows, writeRiserDataSheet } from "@/lib/riser-data-sheet-server";

/** Riser data sheet **export** (#328 A2): the Devices tab — every lighting-control
 *  part, blanks pre-filled by the suggestion rules. Admin only. */
export const maxDuration = 60;

export async function GET() {
  await requirePerm("manage_users");
  const { rows, types } = await loadRiserExportRows();
  const buf = await writeRiserDataSheet(rows, types);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="Peak riser data ${day}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}

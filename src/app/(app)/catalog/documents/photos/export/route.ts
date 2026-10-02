import { requirePerm } from "@/lib/session";
import { buildPhotoSheetExport, writePhotoSheet } from "@/lib/part-docs/photo-sheet-io";

/** Catalog photo sheet **export**: every quoted or portal-department part,
 *  missing-photo first, each Photo slot showing what's already there. */
export const maxDuration = 60;

export async function GET() {
  await requirePerm("create");
  const buf = await writePhotoSheet(await buildPhotoSheetExport());
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="Peak photo sheet ${day}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}

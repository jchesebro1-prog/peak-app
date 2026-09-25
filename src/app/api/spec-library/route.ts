import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { exportLibrary } from "@/lib/specs/library-io";

/**
 * Whole-library export (Task 11). GET-only — import is a server action
 * (`importLibraryAction`) since it needs `requirePerm("create")`, not the
 * read-only `requireUser()` a download route gets.
 */
export async function GET() {
  await requireUser();
  const file = await exportLibrary();
  const date = new Date(file.exportedAt).toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(file, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="peak-spec-library-${date}.json"`,
      "cache-control": "no-store",
    },
  });
}

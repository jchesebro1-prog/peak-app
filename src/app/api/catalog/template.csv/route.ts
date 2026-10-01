import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { CATALOG_TEMPLATE_CSV } from "@/app/(app)/catalog/parse";

/** Download the canonical catalog import shape. */
export async function GET() {
  await requireUser();
  return new NextResponse(CATALOG_TEMPLATE_CSV, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="catalog-import-template.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}

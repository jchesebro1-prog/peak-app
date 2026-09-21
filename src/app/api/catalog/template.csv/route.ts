import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";

/** Download the canonical catalog import shape. */
export async function GET() {
  await requireUser();
  const csv = [
    "MFR Part #,Description,Category,Unit,List,Cost",
    "EXAMPLE-001,Example catalog part,Audio/Video,ea,100.00,65.00",
  ].join("\n") + "\n";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="catalog-import-template.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}

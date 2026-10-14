import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/session";
import { toCsv } from "@/lib/assessments/csv";
import { REGISTER_COLUMNS, parseRegisterFilters, registerCsvName } from "@/lib/assessments/register";
import { loadRegister } from "@/lib/assessments/register-server";

/** The findings register as CSV (#337, Task 9): the same filters as /assessments/findings, the brief's register
 *  columns in order, formula-injection guarded by toCsv. */
export async function GET(req: NextRequest) {
  await requireUser();
  const filters = parseRegisterFilters(req.nextUrl.searchParams);
  const { rows } = await loadRegister(filters);
  const csv = toCsv([...REGISTER_COLUMNS], rows.map((r) => r.cells));
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${registerCsvName(Date.now())}"`,
      "Cache-Control": "no-store",
    },
  });
}

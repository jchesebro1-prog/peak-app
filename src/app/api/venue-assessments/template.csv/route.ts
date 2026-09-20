import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";

export async function GET() {
  await requireUser();
  const csv = [
    "survey_id,customer,venue,venue_type,address,reason,scope_of_work,notes,stage,measure_length_ft,measure_width_ft,measure_height_ft",
    "FS-####,Customer name,Main space,Auditorium,Street address,Survey purpose,Scope to capture,Notes,requested,,,,",
  ].join("\n") + "\n";
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="field-survey-blank.csv"' } });
}

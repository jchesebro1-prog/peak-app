import { requireUser } from "@/lib/session";
import { get } from "@/lib/stores/surveys";
import { getSettings } from "@/lib/settings";
import { renderLetterPdf } from "@/lib/pdf";
import { buildAssessmentSheet } from "@/lib/venue-assessment-sheet";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const record = await get(id);
  if (!record) return new Response("Venue assessment not found", { status: 404 });
  const settings = await getSettings();
  const pdf = renderLetterPdf(buildAssessmentSheet(record, settings.companyName, settings.accent));
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Venue-assessment-${record.id}.pdf"`, "cache-control": "no-store" } });
}

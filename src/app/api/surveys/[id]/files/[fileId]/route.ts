import { getOptionalUser } from "@/lib/session";
import { get as getSurvey } from "@/lib/stores/surveys";
import { surveyFileBytes } from "@/lib/field-files/file-bytes";

/**
 * One survey file (#344 C4): a photo, its markup, a sketch (`image/jpeg`) or a strokes document (`application/json`).
 * Signed-in team only — the middleware already turns away a visitor with no session, and this checks again. The file
 * must be referenced by the survey and its path must be the file's own path in the survey's folder
 * (`surveyFileBytes`); inline (dev) data URLs are decoded. The private Blob is never exposed; the bytes stream through
 * this route with `nosniff`.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; fileId: string }> }) {
  const user = await getOptionalUser();
  if (!user) return new Response("Unauthorized", { status: 401, headers: { "cache-control": "private, no-store" } });
  const { id, fileId } = await ctx.params;
  const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });
  const survey = /^FS-\d+$/.test(id) ? await getSurvey(id) : null;
  if (!survey) return notFound();
  let found: Awaited<ReturnType<typeof surveyFileBytes>>;
  try {
    found = await surveyFileBytes(survey, fileId);
  } catch {
    // Never surface the Blob vendor's own error text.
    return new Response("Couldn't read the file — try again", { status: 502, headers: { "cache-control": "private, no-store" } });
  }
  if (!found) return notFound();
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      "content-type": found.contentType,
      "content-length": String(found.bytes.length),
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=3600",
    },
  });
}

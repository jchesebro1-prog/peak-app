import { getOptionalUser } from "@/lib/session";
import { getAssessment } from "@/lib/stores/assessments";
import { photoBytes } from "@/lib/assessments/photo-bytes";

/**
 * One assessment photo (#337). Signed-in team only — the middleware already turns away a visitor with no session, and
 * this checks again. The print route does not come through here: it reads `photoBytes` on the server and inlines the
 * image, so headless Chrome never needs a session or a token. The private Blob is never exposed; the bytes stream
 * through this route as `image/jpeg` + `nosniff`.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; photoId: string }> }) {
  const user = await getOptionalUser();
  if (!user) return new Response("Unauthorized", { status: 401, headers: { "cache-control": "private, no-store" } });
  const { id, photoId } = await ctx.params;
  const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });
  const assessment = await getAssessment(id);
  if (!assessment) return notFound();
  let found: Awaited<ReturnType<typeof photoBytes>>;
  try {
    found = await photoBytes(assessment, photoId);
  } catch {
    // Never surface the Blob vendor's own error text.
    return new Response("Couldn't read the photo — try again", { status: 502, headers: { "cache-control": "private, no-store" } });
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

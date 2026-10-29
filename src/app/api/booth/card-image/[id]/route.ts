import { requireUser } from "@/lib/session";
import { getCapture } from "@/lib/stores/booth";
import { dataUrlToBytes, getBlobStream } from "@/lib/blob";

export const dynamic = "force-dynamic";

/** Signed in: one booth capture's business-card photo (private Blob, or inline in dev). Bytes stream through here with `nosniff`; the Blob URL is never exposed. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await ctx.params;
  const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });
  const c = await getCapture(id);
  if (!c?.cardImagePath) return notFound();
  const headers = {
    "content-type": "image/jpeg",
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
  };
  if (c.cardImagePath === "inline") {
    const inline = (c as { cardImage?: string }).cardImage;
    if (!inline) return notFound();
    const { bytes } = dataUrlToBytes(inline);
    return new Response(new Uint8Array(bytes), { headers: { ...headers, "content-length": String(bytes.length) } });
  }
  try {
    const stream = await getBlobStream(c.cardImagePath);
    if (!stream) return notFound();
    return new Response(stream, { headers });
  } catch {
    // Never surface the Blob vendor's own error text.
    return new Response("Couldn't read the file — try again", { status: 502, headers: { "cache-control": "private, no-store" } });
  }
}

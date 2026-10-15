import { requireUser } from "@/lib/session";
import { mailboxViewer } from "@/lib/mailbox-viewer";
import { attachmentDisposition } from "@/lib/document-files";
import { zipStream } from "@/lib/zip";
import { parseThreadAttachmentRef } from "@/lib/vendor-quotes/rules";
import { readThreadAttachment } from "@/lib/vendor-quotes/thread-attachment-server";

/* #348 slice 4 — download one email attachment (an imported Gmail attachment by reference, or a stored one) for
   anyone who can see the thread (#341 canSeeThread, checked inside readThreadAttachment). Every failure is the same
   plain 404 — a thread you can't see reads exactly like a missing one. */
export const maxDuration = 60;

const SAFE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ threadId: string; messageId: string; index: string }> }
) {
  const user = await requireUser();
  const viewer = await mailboxViewer(user);
  const { threadId, messageId, index } = await ctx.params;
  let ref: ReturnType<typeof parseThreadAttachmentRef> = null;
  try {
    ref = parseThreadAttachmentRef(`${decodeURIComponent(threadId)}~${decodeURIComponent(messageId)}~${index}`);
  } catch {
    ref = null; // a malformed escape is just another 404
  }
  if (!ref) return new Response("Not found", { status: 404 });
  const r = await readThreadAttachment(ref, viewer);
  if (!r.ok) return new Response("Not found", { status: 404 });
  // Streamed (the shared chunker, as the report-pdf / rack submittal routes): a buffered function response is capped
  // around 4.5 MB on Vercel. Only inert types keep their own type; everything else downloads as an octet stream.
  const mime = r.mime.toLowerCase().split(";")[0].trim();
  return new Response(zipStream(r.bytes), {
    headers: {
      "content-type": SAFE_TYPES.has(mime) ? mime : "application/octet-stream",
      "content-disposition": attachmentDisposition(r.name),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}

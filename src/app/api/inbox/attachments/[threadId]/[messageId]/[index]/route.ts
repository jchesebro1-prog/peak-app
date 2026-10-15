import { requireUser } from "@/lib/session";
import { mailboxViewer } from "@/lib/mailbox-viewer";
import { safeName } from "@/lib/blob";
import { parseThreadAttachmentRef } from "@/lib/vendor-quotes/rules";
import { readThreadAttachment } from "@/lib/vendor-quotes/thread-attachment-server";

/* #348 slice 4 — download one email attachment (an imported Gmail attachment by reference, or a stored one) for
   anyone who can see the thread (#341 canSeeThread, checked inside readThreadAttachment). Every failure is the same
   plain 404 — a thread you can't see reads exactly like a missing one. */
export const maxDuration = 60;

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
  return new Response(r.bytes as unknown as BodyInit, {
    headers: {
      "content-type": r.mime,
      "content-disposition": `attachment; filename="${safeName(r.name)}"`,
      "cache-control": "private, max-age=300",
    },
  });
}

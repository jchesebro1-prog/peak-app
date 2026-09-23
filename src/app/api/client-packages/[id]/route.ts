import { requireUser } from "@/lib/session";
import { getBlobStream, safeName } from "@/lib/blob";
import { getClientPackage } from "@/lib/stores/client-packages";

/** Authenticated download proxy for a generated client package. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const record = await getClientPackage(decodeURIComponent(id));
  if (!record) return new Response("Not found", { status: 404 });
  const stream = await getBlobStream(record.blobPath);
  if (!stream) return new Response("Package missing from storage", { status: 404 });
  return new Response(stream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${safeName(record.fileName)}"`,
      "cache-control": "private, no-store",
    },
  });
}

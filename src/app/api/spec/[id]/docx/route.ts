import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildSpecDocx } from "@/lib/bid-spec-docx";
import { getGeneratedSpec } from "@/lib/stores/generated-specs";

/**
 * .docx download for a saved bid spec (D94 upgrade).
 * A route handler rather than a client-side blob: the docx Packer is a Node
 * builder, and keeping it server-side keeps ~200KB of OOXML machinery out of
 * the browser bundle.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const rec = await getGeneratedSpec(id);
  if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 });

  const buf = await buildSpecDocx(rec.spec);
  const name = `${rec.spec.projectName.replace(/[^a-z0-9]+/gi, "-")}-specification.docx`;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}

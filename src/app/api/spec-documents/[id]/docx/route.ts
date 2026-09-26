import { requireUser } from "@/lib/session";
import { loadAssembledSpec } from "@/lib/specs/load-spec";
import { buildSectionDocx } from "@/lib/specs/spec-docx";
import { specFileName } from "@/lib/specs/spec-file-name";

/**
 * .docx download for a saved spec (#205 Phase B, design §4). A route handler
 * because the docx Packer is a Node builder; 404 for an unknown spec, 409
 * when its section has since been deleted from the library.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await ctx.params;
  const { doc, section, assembled } = await loadAssembledSpec(id);
  if (!doc.id) return new Response("Spec not found.", { status: 404 });
  if (!section || !assembled) return new Response("This section is no longer in the library.", { status: 409 });
  const buf = await buildSectionDocx(assembled);
  const name = specFileName(doc.header, section);
  // Header values must be Latin-1 (a project name with an en dash would
  // throw), so the plain filename= is an ASCII fallback; filename*= carries
  // the real name.
  const rfc5987 = encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${rfc5987}`,
      "Cache-Control": "no-store",
    },
  });
}

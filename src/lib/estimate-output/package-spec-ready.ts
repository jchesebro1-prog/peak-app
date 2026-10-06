import { hasPrintableSpec } from "@/lib/specs/articles";

/**
 * Whether the Specifications.docx will actually have content: at least one BOM
 * part has printable spec text AND its section still exists in the sections
 * `assemble` builds from (a deleted section drops its parts from the docx).
 */
export function specReadyFor(
  parts: ReadonlyArray<{ specSectionId?: string; specBody?: string; specState?: "authored" | "draft" }>,
  sections: ReadonlyArray<{ id: string }>,
): boolean {
  const ids = new Set(sections.map((s) => s.id));
  return parts.some((p) => !!p.specSectionId && ids.has(p.specSectionId) && hasPrintableSpec(p));
}

import { getDoc, listDocs, upsertDoc, softDeleteDoc, type Doc } from "@/db/doc-store";
import { STARTER_TEMPLATES, scaffoldFrom, templateId, type SpecTemplate, type SpecTemplateHeading } from "@/lib/specs/templates";

/**
 * Authoring formulas (#205). A template is not spec text — it is the shape of
 * a spec entry for one kind of product: which headings to write, what to pull
 * from the cut sheet for each, and the phrasing rules. "Insert template" in
 * the part editor writes the headings as a scaffold into an empty body, and
 * `Export templates` writes this collection to the JSON file the spec-writer
 * skill reads. No template text ever prints in a document.
 *
 * The template shape itself (types, `scaffoldFrom`, `templateId`, the starter
 * formulas) lives in the pure `src/lib/specs/templates.ts` module — see its
 * header comment — so it can be imported by client code without dragging in
 * the database.
 */

export type { SpecTemplate, SpecTemplateHeading };
export { scaffoldFrom, templateId, STARTER_TEMPLATES };

function normalize(raw: unknown): SpecTemplate {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const headings = Array.isArray(o.headings)
    ? o.headings
        .map((h) => {
          const x = (h && typeof h === "object" ? h : {}) as Record<string, unknown>;
          return { label: String(x.label || "").trim(), guidance: String(x.guidance || "").trim() };
        })
        .filter((h) => h.label)
    : [];
  const key = String(o.key || "").trim();
  return {
    id: String(o.id || "") || templateId(key),
    key,
    title: String(o.title || "").trim(),
    headings,
    rules: typeof o.rules === "string" ? o.rules : "",
    example: typeof o.example === "string" ? o.example : "",
    updatedAt: Number(o.updatedAt) || 0,
    updatedBy: String(o.updatedBy || ""),
  };
}

export async function allTemplates(): Promise<SpecTemplate[]> {
  const list = await listDocs<Doc>("spec_templates");
  return list.map(normalize).sort((a, b) => a.key.localeCompare(b.key));
}

export async function getTemplate(id: string): Promise<SpecTemplate | null> {
  const raw = await getDoc<Doc>("spec_templates", id);
  return raw ? normalize(raw) : null;
}

export async function saveTemplate(
  input: Omit<SpecTemplate, "id" | "updatedAt" | "updatedBy">,
  by: string
): Promise<SpecTemplate> {
  const rec = normalize({ ...input, id: templateId(input.key), updatedAt: Date.now(), updatedBy: by });
  if (!rec.id) throw new Error("A template needs a key.");
  await upsertDoc<SpecTemplate>("spec_templates", rec);
  return rec;
}

export async function deleteTemplate(id: string): Promise<void> {
  await softDeleteDoc("spec_templates", id);
}

/**
 * Idempotent by key — never overwrites a formula someone edited. Called from
 * `seedIfEmpty()` regardless of the demo-data flag, because the go-live reset
 * wipes every doc collection (`DEMO_COLLECTIONS` is `Object.keys(DOC_TABLES)`)
 * and the formulas are configuration, not demo data.
 */
export async function seedStarterTemplates(by = "Peak"): Promise<number> {
  const have = new Set((await allTemplates()).map((t) => t.id));
  let made = 0;
  for (const t of STARTER_TEMPLATES) {
    if (have.has(templateId(t.key))) continue;
    await saveTemplate(t, by);
    made++;
  }
  return made;
}

/**
 * Owner decision (2026-09-25): the formulas auto-seed when empty on ANY
 * environment — `seedIfEmpty()` only runs on local dev, and a hosted database
 * (or one after a go-live reset) would otherwise show an empty Templates
 * screen and an empty "Insert template" row. Seeds a collection only when it
 * holds no live record at all, so deleting one formula does not bring it
 * back; deleting every formula does (the Restore button is the explicit path).
 * Called from read paths (server components), so it must not call
 * revalidatePath. Cheap on the hot path: one listDocs per collection.
 */
export async function ensureStarterTemplates(by = "Peak"): Promise<number> {
  const { allCurtainTemplates, seedStarterCurtainTemplates } = await import("@/lib/stores/spec-curtain-templates");
  let made = 0;
  if ((await allTemplates()).length === 0) made += await seedStarterTemplates(by);
  if ((await allCurtainTemplates()).length === 0) made += await seedStarterCurtainTemplates(by);
  return made;
}

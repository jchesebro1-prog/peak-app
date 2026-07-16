"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getSettings, setSettings } from "@/lib/settings";
import {
  TEMPLATES,
  getTemplateDef,
  type TemplateOverrides,
} from "@/lib/templates";

/**
 * Templates screen server actions (IDEAS — centralized templates). Editing is
 * limited to Admins and Managers; everyone else can view/download (enforced
 * in the page). Writes are validated against the registry (unknown template
 * or field ids are dropped) and length-capped, then merged into the settings
 * blob as a sparse override map, exactly like saveIntakeCatalogAction.
 */

const MAX_FIELD_CHARS = 8000;

function canEditTemplates(roles: string[]): boolean {
  return roles.includes("Admin") || roles.includes("Manager");
}

type SaveResult =
  | { ok: true; meta: { by: string; at: number } }
  | { ok: false; error: string };

/** Only keep field ids that exist on the template; cap length; drop values
 *  equal to the built-in default so the stored map stays sparse. */
function sanitizeFields(
  templateId: string,
  fields: Record<string, unknown>
): Record<string, string> {
  const def = getTemplateDef(templateId);
  if (!def) return {};
  const out: Record<string, string> = {};
  for (const f of def.fields) {
    const raw = fields[f.id];
    if (typeof raw !== "string") continue;
    const val = raw.slice(0, MAX_FIELD_CHARS);
    if (val !== f.default) out[f.id] = val; // equal-to-default → no override
  }
  return out;
}

/** Save one template's fields. Fields equal to the default clear their
 *  override; a template with no remaining overrides is removed entirely. */
export async function saveTemplateAction(
  templateId: string,
  fields: Record<string, string>
): Promise<SaveResult> {
  const user = await requireUser();
  if (!canEditTemplates(user.roles))
    return { ok: false, error: "Only Admins and Managers can edit templates." };
  if (!getTemplateDef(templateId))
    return { ok: false, error: "Unknown template." };

  const settings = await getSettings();
  const templates: TemplateOverrides = { ...(settings.templates || {}) };
  const clean = sanitizeFields(templateId, fields);
  if (Object.keys(clean).length) templates[templateId] = clean;
  else delete templates[templateId];

  const at = Date.now();
  const meta = { ...(settings.templatesMeta || {}), [templateId]: { by: user.name, at } };
  await setSettings({ templates, templatesMeta: meta });
  revalidatePath("/templates");
  return { ok: true, meta: { by: user.name, at } };
}

/** Reset a whole template back to its built-in defaults. */
export async function resetTemplateAction(
  templateId: string
): Promise<SaveResult> {
  const user = await requireUser();
  if (!canEditTemplates(user.roles))
    return { ok: false, error: "Only Admins and Managers can edit templates." };

  const settings = await getSettings();
  const templates: TemplateOverrides = { ...(settings.templates || {}) };
  delete templates[templateId];
  const at = Date.now();
  const meta = { ...(settings.templatesMeta || {}), [templateId]: { by: user.name, at } };
  await setSettings({ templates, templatesMeta: meta });
  revalidatePath("/templates");
  return { ok: true, meta: { by: user.name, at } };
}

/**
 * Replace template wording from an uploaded backup (Download → edit → Upload).
 * Accepts the same { [templateId]: { [fieldId]: string } } shape produced by
 * the download; unknown template/field ids are ignored and every value is
 * validated + capped. Templates present in the upload are replaced; templates
 * absent from it are left untouched.
 */
export async function importTemplatesAction(
  incoming: unknown
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!canEditTemplates(user.roles))
    return { ok: false, error: "Only Admins and Managers can edit templates." };
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming))
    return { ok: false, error: "That file isn't a valid template backup." };

  const src = incoming as Record<string, unknown>;
  const settings = await getSettings();
  const templates: TemplateOverrides = { ...(settings.templates || {}) };
  const metaSrc = { ...(settings.templatesMeta || {}) };
  const at = Date.now();
  let count = 0;

  for (const def of TEMPLATES) {
    const block = src[def.id];
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const clean = sanitizeFields(def.id, block as Record<string, unknown>);
    if (Object.keys(clean).length) templates[def.id] = clean;
    else delete templates[def.id];
    metaSrc[def.id] = { by: user.name, at };
    count++;
  }
  if (!count)
    return { ok: false, error: "No recognized templates were found in that file." };

  await setSettings({ templates, templatesMeta: metaSrc });
  revalidatePath("/templates");
  return { ok: true, count };
}

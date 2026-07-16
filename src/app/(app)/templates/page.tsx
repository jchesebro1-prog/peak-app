import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { TEMPLATES } from "@/lib/templates";
import { TemplatesEditor } from "./templates-editor";

export const metadata = { title: "Templates — Peak Backend" };

/**
 * Templates screen (IDEAS — centralized templates). The one place to edit the
 * wording of every generated customer-facing document. Admins & Managers edit;
 * everyone can view and download. The heavy lifting (editor, preview, upload/
 * download) is client-side; this just loads the current overrides + stamps.
 */
export default async function TemplatesPage() {
  const [user, settings] = await Promise.all([requireUser(), getSettings()]);
  const canEdit = user.roles.includes("Admin") || user.roles.includes("Manager");
  return (
    <div className="pk-content">
      <TemplatesEditor
        templates={TEMPLATES}
        overrides={settings.templates || {}}
        meta={settings.templatesMeta || {}}
        canEdit={canEdit}
      />
    </div>
  );
}

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { DEFAULT_SETTINGS } from "@/db/seed-data";

/**
 * AppSettings — port of settings.js. The DB row stores a sparse patch over
 * DEFAULTS, exactly like the prototype's localStorage blob (rss_settings_v1).
 * The prototype's live `rss-settings` event becomes router.refresh() after
 * the update action (server components re-read per request).
 */

export type Office = {
  id: string;
  type?: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone?: string;
  lat: number | null;
  lng: number | null;
};

export type AppSettingsData = {
  accent: string;
  companyName: string;
  federalHolidays: boolean;
  seedDemo: boolean;
  feedbackEmail: string;
  offices: Office[];
  /** Site-intake type catalog overrides, keyed by category (e.g.
   * "lighting.fixture") — see DEFAULT_INTAKE_CATALOG in survey-intake.ts. */
  intakeCatalog?: Record<string, string[]>;
  /** Site-visit reason picklist overrides (D76) — see DEFAULT_VISIT_REASONS
   *  in stores/site-visits.ts; empty/absent means use the defaults. */
  visitReasons?: string[];
  /** Brand marks (IDEAS #32) — small data-URL images uploaded in Settings →
   *  Branding. `logoLight` sits on the dark nav bar; `logoDark` heads white
   *  documents (letters + reports) in place of the baked-in letterhead. */
  logoLight?: string | null;
  logoDark?: string | null;
  /** Document-template wording overrides (IDEAS — centralized templates),
   *  a sparse map { [templateId]: { [fieldId]: string } } over the built-in
   *  defaults in lib/templates.ts. Edited in the Templates screen. */
  templates?: import("@/lib/templates").TemplateOverrides;
  /** Per-template "last edited by/when" stamp (replace-in-place). */
  templatesMeta?: Record<string, { by: string; at: number }>;
};

export async function getSettingsPatch(): Promise<Record<string, unknown>> {
  try {
    const db = await getDb();
    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, "main"))
      .limit(1);
    return rows[0]?.data ?? {};
  } catch {
    // Settings must never take the app down (e.g. before first migration).
    return {};
  }
}

export async function getSettings(): Promise<AppSettingsData> {
  const patch = await getSettingsPatch();
  return { ...DEFAULT_SETTINGS, ...patch } as AppSettingsData;
}

/** Merge a patch into the stored settings (port of AppSettings.set). */
export async function setSettings(
  patch: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  const current = await getSettingsPatch();
  const next = { ...current, ...patch };
  const rows = await db
    .select({ id: appSettings.id })
    .from(appSettings)
    .where(eq(appSettings.id, "main"))
    .limit(1);
  if (rows.length) {
    await db
      .update(appSettings)
      .set({ data: next, updatedAt: Date.now() })
      .where(eq(appSettings.id, "main"));
  } else {
    await db
      .insert(appSettings)
      .values({ id: "main", data: next, updatedAt: Date.now() });
  }
}

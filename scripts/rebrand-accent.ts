/**
 * One-time Q-6 rebrand backfill (D117): if the stored settings row still
 * carries the OLD default purple accent explicitly, move it to the new
 * Q-6 gold default. A deliberately customized accent is left alone.
 * Run: npx tsx scripts/rebrand-accent.ts   (works against the local PGlite
 * dev DB, or against prod when DATABASE_URL is set in the environment).
 */
import { getSettingsPatch, setSettings } from "@/lib/settings";

const OLD_DEFAULT = "#7b3f8a";
const NEW_DEFAULT = "#b08d4a";

const patch = await getSettingsPatch();
const stored = typeof patch.accent === "string" ? patch.accent.toLowerCase() : undefined;
if (stored === OLD_DEFAULT) {
  await setSettings({ accent: NEW_DEFAULT });
  console.log(`accent: ${OLD_DEFAULT} (old default) -> ${NEW_DEFAULT} (Q-6 gold)`);
} else {
  console.log(`accent untouched: ${stored ?? "(unset — new default applies)"}`);
}
process.exit(0);

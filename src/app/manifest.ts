import type { MetadataRoute } from "next";
import { getSettings } from "@/lib/settings";
import { iconVersion, manifestIcons } from "@/lib/app-icon";

/**
 * The PWA manifest (was public/manifest.webmanifest). Batch 6 / #67: the
 * icons are drawn from the Settings → Branding logo (/icons/app/*.png), and
 * their `?v=` changes with the logo so an installed app picks the new icon
 * up. Dynamic — it reads settings on every request, never at build time.
 */
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const version = iconVersion(await getSettings());
  return {
    name: "Quartzite-6",
    short_name: "Quartzite-6",
    description: "Peak Systems Group — business management",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0e0f12",
    theme_color: "#0e0f12",
    icons: manifestIcons(version),
  };
}

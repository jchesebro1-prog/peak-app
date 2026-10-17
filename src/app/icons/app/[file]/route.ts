import { getSettings } from "@/lib/settings";
import { iconCacheControl, iconSource, iconVersion, parseIconFile } from "@/lib/app-icon";
import { renderAppIcon } from "@/lib/app-icon-render";

/**
 * Batch 6 / #67 — the app icon from Settings → Branding: /icons/app/32.png,
 * 180.png, 192.png, 512.png and 512-maskable.png. Public (the /icons prefix is
 * outside the session gate in middleware.ts) — it serves only the brand logo
 * the portal already shows. `?v=` is the logo version (lib/app-icon.ts): a
 * request naming the current version is cached for a year, anything else for
 * five minutes, so a new logo shows as soon as pages link the new version.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const parsed = parseIconFile((await params).file);
  if (!parsed) return new Response("Not found", { status: 404 });
  const settings = await getSettings();
  const version = iconVersion(settings);
  const png = await renderAppIcon(iconSource(settings), version, parsed.size, parsed.maskable);
  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "cache-control": iconCacheControl(new URL(req.url).searchParams.get("v"), version),
      "x-content-type-options": "nosniff",
    },
  });
}

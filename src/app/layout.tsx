import type { Metadata } from "next";
import { Public_Sans, IBM_Plex_Mono } from "next/font/google";
import { cache, type CSSProperties } from "react";
import { getSettings } from "@/lib/settings";
import { accentContrast } from "@/lib/color";
import { POP_HEAD_SCRIPT } from "@/lib/popout/live";
import { iconHref, iconVersion } from "@/lib/app-icon";
import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

/** #356 review — one settings read per request, shared by generateMetadata and the layout. */
const requestSettings = cache(() => getSettings());

/** Batch 6 / #67 — the favicon and apple-touch-icon are drawn from the
 *  Settings → Branding logo (lib/app-icon.ts), versioned so a new logo
 *  replaces the cached icon; with no logo they are the built-in mark. */
export async function generateMetadata(): Promise<Metadata> {
  const v = iconVersion(await requestSettings());
  return {
    title: "Quartzite-6",
    description: "Peak Systems Group — business management",
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [{ url: iconHref(32, v), sizes: "32x32", type: "image/png" }, { url: iconHref(192, v), sizes: "192x192", type: "image/png" }],
      apple: [{ url: iconHref(180, v), sizes: "180x180", type: "image/png" }],
    },
    appleWebApp: { capable: true, title: "Quartzite-6", statusBarStyle: "black-translucent" },
  };
}

export const viewport = {
  themeColor: "#0e0f12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const settings = await requestSettings();
  return (
    <html
      lang="en"
      // The head script below may add `pk-pop` before React hydrates.
      suppressHydrationWarning
      style={
        {
          "--accent": settings.accent,
          "--accent-contrast": accentContrast(settings.accent),
        } as CSSProperties
      }
    >
      <head>
        {/* Pop-out mode (spec §2): a plain inline script runs synchronously
            while the HTML parses, so a pop-out never paints its nav. Next 16
            docs ("Preventing flash before hydration") — next/script
            beforeInteractive doesn't block, so it could paint first. */}
        <script dangerouslySetInnerHTML={{ __html: POP_HEAD_SCRIPT }} />
      </head>
      <body className={`${publicSans.variable} ${plexMono.variable}`}>
        {children}
      </body>
    </html>
  );
}

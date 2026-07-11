import type { Metadata } from "next";
import { Public_Sans, IBM_Plex_Mono } from "next/font/google";
import type { CSSProperties } from "react";
import { getSettings } from "@/lib/settings";
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

export const metadata: Metadata = {
  title: "Peak Backend",
  description: "Peak Systems Group — business management",
};

export const viewport = { themeColor: "#16181d" };

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const settings = await getSettings();
  return (
    <html lang="en" style={{ "--accent": settings.accent } as CSSProperties}>
      <body className={`${publicSans.variable} ${plexMono.variable}`}>
        {children}
      </body>
    </html>
  );
}

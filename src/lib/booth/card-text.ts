"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
import { isNativePlatform } from "@/lib/platform";

/**
 * Business-card text recognition on the device (no network, no AI — D89):
 * Apple Vision on iOS, ML Kit on Android, through the app's own local
 * `CardText` plugin (ios/App/App/CardTextPlugin.swift,
 * android/…/CardTextPlugin.java). Not available in a browser.
 */

interface CardTextPlugin {
  recognize(opts: { base64: string }): Promise<{ lines: string[] }>;
}

const CardText = registerPlugin<CardTextPlugin>("CardText");

export function cardTextAvailable(): boolean {
  return isNativePlatform() && Capacitor.isPluginAvailable("CardText");
}

export async function recognizeCardLines(jpegBase64: string): Promise<string[]> {
  const { lines } = await CardText.recognize({ base64: jpegBase64 });
  return Array.isArray(lines) ? lines.map(String) : [];
}

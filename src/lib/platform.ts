import { Capacitor } from "@capacitor/core";

/** True when the app is running inside an iOS or Android Capacitor WebView. */
export function isNativePlatform(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

/** The native platform name, or `web` for browsers and server rendering. */
export function platformName(): "ios" | "android" | "web" {
  if (!isNativePlatform()) return "web";

  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android" ? platform : "web";
}

/** Native-only capabilities can use this guard without importing Capacitor. */
export function supportsNativeBridge(): boolean {
  return isNativePlatform();
}

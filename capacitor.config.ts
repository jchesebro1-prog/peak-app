import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Quartzite's native shell uses Capacitor's remote/hybrid mode. Next's App
 * Router and server actions stay on Vercel; the iOS/Android projects provide
 * the native container and a bridge for future device capabilities.
 *
 * Set CAPACITOR_SERVER_URL when testing a local or preview deployment, e.g.
 * `CAPACITOR_SERVER_URL=http://192.168.1.42:3000 npx cap sync`.
 */
const serverUrl = process.env.CAPACITOR_SERVER_URL ?? "https://quartzite-six.vercel.app";

const config: CapacitorConfig = {
  appId: "com.peaksystemsgroup.quartzite",
  appName: "Quartzite",
  // The app is SSR and cannot be exported from Next into the native bundle.
  // Keep a tiny native fallback page so Capacitor can still sync; the remote
  // server URL below is what the WebView loads at runtime.
  webDir: "native-web",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
  },
  ios: {
    contentInset: "never",
  },
};

export default config;

"use client";

import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { isNativePlatform } from "@/lib/platform";
import { handleNativeAuthUrl, NATIVE_AUTH_SCHEME_PREFIX } from "@/lib/native-auth-client";

/**
 * Mounted on the login page. Inside the Capacitor shell it listens for the
 * quartzite://auth deep link (warm: appUrlOpen; cold: getLaunchUrl) and
 * finishes the sign-in hand-off. Renders nothing on the web.
 */
export default function NativeAuthReturn() {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  // Cold start can deliver the same launch URL to both getLaunchUrl() and an
  // appUrlOpen event; without dedup that double-handles it (two exchanges of
  // the same one-time code, the second always failing).
  const handledUrls = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isNativePlatform() || !Capacitor.isPluginAvailable("App")) return;
    let remove: (() => Promise<void>) | undefined;
    let disposed = false;

    const handle = async (url: string) => {
      if (disposed) return;
      // Cheap pre-check before touching state: a non-auth launch URL (e.g. a
      // plain cold start with no deep link) should never flash "Signing you
      // in…", and handleNativeAuthUrl's own parsing check is not worth a
      // render just to say "ignored".
      if (!url.startsWith(NATIVE_AUTH_SCHEME_PREFIX)) return;
      if (handledUrls.current.has(url)) return;
      handledUrls.current.add(url);
      setState("busy");
      const result = await handleNativeAuthUrl(url);
      if (disposed) return;
      if (result === "failed") setState("failed");
      else if (result === "ignored") setState("idle");
    };

    (async () => {
      const { App } = await import("@capacitor/app");
      const listener = await App.addListener("appUrlOpen", ({ url }) => void handle(url));
      if (disposed) {
        void listener.remove();
        return;
      }
      remove = () => listener.remove();
      const launch = await App.getLaunchUrl();
      if (launch?.url) void handle(launch.url);
    })().catch(() => {
      /* plugin missing at runtime — web flow still works */
    });

    return () => {
      disposed = true;
      void remove?.();
    };
  }, []);

  if (state === "idle") return null;
  return (
    <div style={{ textAlign: "center", marginTop: 12, fontSize: 12.5, color: "#9aa0ab" }}>
      {state === "busy" ? "Signing you in…" : "Sign-in could not be completed. Try again."}
    </div>
  );
}

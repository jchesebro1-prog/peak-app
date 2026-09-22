"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { isNativePlatform } from "@/lib/platform";
import { handleNativeAuthUrl } from "@/lib/native-auth-client";

/**
 * Mounted on the login page. Inside the Capacitor shell it listens for the
 * quartzite://auth deep link (warm: appUrlOpen; cold: getLaunchUrl) and
 * finishes the sign-in hand-off. Renders nothing on the web.
 */
export default function NativeAuthReturn() {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");

  useEffect(() => {
    if (!isNativePlatform() || !Capacitor.isPluginAvailable("App")) return;
    let remove: (() => Promise<void>) | undefined;
    let cancelled = false;

    const handle = async (url: string) => {
      setState("busy");
      const result = await handleNativeAuthUrl(url);
      if (cancelled) return;
      if (result === "failed") setState("failed");
      else if (result === "ignored") setState("idle");
    };

    (async () => {
      const { App } = await import("@capacitor/app");
      const listener = await App.addListener("appUrlOpen", ({ url }) => void handle(url));
      remove = () => listener.remove();
      const launch = await App.getLaunchUrl();
      if (launch?.url) void handle(launch.url);
    })().catch(() => {
      /* plugin missing at runtime — web flow still works */
    });

    return () => {
      cancelled = true;
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

"use client";

import { Capacitor } from "@capacitor/core";
import { isNativePlatform } from "@/lib/platform";

/**
 * Client side of the native sign-in hand-off
 * (docs/superpowers/specs/2026-09-21-native-auth-handoff-design.md).
 * Only ever active inside the Capacitor shell with the Browser/App plugins
 * present; every other combination returns false/"ignored" so callers fall
 * back to the plain web flow (version-skew rule, D132).
 */

export const NATIVE_AUTH_SCHEME_PREFIX = "quartzite://auth";
const VERIFIER_KEY = "qz_native_verifier";

/**
 * Exact scheme + host match rather than a string prefix, so a URL like
 * "quartzite://authx?…" or "quartzite://auth.evil?…" can't slip through.
 */
export function isNativeAuthUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "quartzite:" && parsed.host === "auth";
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

/** True when the sheet was opened; false means "use the web sign-in". */
export async function startNativeGoogleSignIn(next: string): Promise<boolean> {
  if (!isNativePlatform() || !Capacitor.isPluginAvailable("Browser")) return false;
  try {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    localStorage.setItem(VERIFIER_KEY, verifier);
    const url = new URL("/api/native/auth/start", window.location.origin);
    url.searchParams.set("next", next);
    url.searchParams.set("challenge", await challengeFor(verifier));
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: url.toString() });
    return true;
  } catch {
    return false;
  }
}

async function closeSheet(): Promise<void> {
  if (!Capacitor.isPluginAvailable("Browser")) return;
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.close();
  } catch {
    // Already closed (the user may have dismissed it) — nothing to do.
  }
}

function isSafeNext(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\");
}

/**
 * Handle a URL the OS delivered to the app. Non-auth URLs are "ignored".
 * On "done" the page has been navigated to `next`; on "failed" the caller
 * shows a retry message.
 */
export async function handleNativeAuthUrl(url: string): Promise<"ignored" | "done" | "failed"> {
  if (!isNativeAuthUrl(url)) return "ignored";
  const parsed = new URL(url);
  const verifier = localStorage.getItem(VERIFIER_KEY);
  const code = parsed.searchParams.get("code");
  void closeSheet();
  if (!code || !verifier) return "failed";
  try {
    const res = await fetch("/api/native/auth/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, verifier }),
      credentials: "same-origin",
    });
    // Only burn the verifier once we know the code has been consumed (or is
    // definitively dead) — a network error or unexpected status leaves it in
    // place so a retry of the same quartzite:// URL can still work.
    if (res.ok || res.status === 401) localStorage.removeItem(VERIFIER_KEY);
    if (!res.ok) return "failed";
    const { next } = (await res.json()) as { next?: string };
    window.location.replace(typeof next === "string" && isSafeNext(next) ? next : "/");
    return "done";
  } catch {
    return "failed";
  }
}

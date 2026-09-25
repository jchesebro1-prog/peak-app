import { isPrivateHost } from "@/lib/auth-redirect";
import { DAY_MS, parseIcs, type AvailWindow } from "@/lib/venue-availability";

/**
 * Server-only fetch of a venue's external .ics feed. Kept separate from the
 * pure engine (venue-availability.ts) — that file is client-bundle-safe by
 * design, and `fetch`-ing an admin-typed URL server-side has its own SSRF
 * guard that doesn't belong in a module a browser also loads.
 */

const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

export type IcsFetchResult =
  | { ok: true; windows: AvailWindow[] }
  | { ok: false; error: string };

/** `webcal://` is a convention meaning "fetch this over https" — every
 *  calendar app treats it that way, so normalize it before the request. */
function normalizeIcsUrl(raw: string): string {
  const s = raw.trim();
  if (/^webcal:\/\//i.test(s)) return "https://" + s.slice("webcal://".length);
  return s;
}

/** 169.254.0.0/16 (link-local) — not covered by auth-redirect's
 *  `isPrivateHost` (that check is scoped to what a same-origin/local-hop
 *  sign-in redirect can legitimately be), but a very real SSRF target here:
 *  it's the cloud metadata address (169.254.169.254) on every major
 *  provider, reachable from inside a hosted function even though it isn't
 *  "private" in the DNS/routing sense `isPrivateHost` cares about. */
function isLinkLocalHost(h: string): boolean {
  return /^169\.254(\.\d{1,3}){2}$/.test(h);
}

/** Reject anything that isn't a plain http(s) URL to a public, routable
 *  host — a venue calendar URL is admin-typed, so this is the SSRF guard
 *  for a server-initiated fetch of it (same private-host check the sign-in
 *  redirect uses, src/lib/auth-redirect.ts, plus the link-local range that
 *  check doesn't need to know about). */
export function validateIcsUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const normalized = normalizeIcsUrl(raw);
  let u: URL;
  try {
    u = new URL(normalized);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "Only http(s) and webcal links are supported." };
  }
  if (isPrivateHost(u.hostname) || isLinkLocalHost(u.hostname)) {
    return { ok: false, error: "That host isn't reachable from the server." };
  }
  return { ok: true, url: u.toString() };
}

/**
 * Fetch + parse a venue's .ics feed for [now-30d, now+400d). Fails soft on
 * every error (bad URL, timeout, non-calendar body, oversized body) —
 * returns `{ ok: false, error }` rather than throwing, so a caller can
 * always fall back to whatever windows it already had.
 */
export async function fetchIcsWindows(rawUrl: string, tz?: string): Promise<IcsFetchResult> {
  const valid = validateIcsUrl(rawUrl);
  if (!valid.ok) return valid;
  try {
    const res = await fetch(valid.url, {
      headers: { Accept: "text/calendar, text/plain, */*", "User-Agent": "peak-app/1.0 (Peak Systems Group venue calendars)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, error: `Feed returned HTTP ${res.status}.` };

    // Cap the body read so a misbehaving/huge feed can't hold the request
    // open indefinitely or blow up memory — read via the stream and bail
    // once the cap is exceeded, rather than trusting Content-Length.
    let text: string;
    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let out = "";
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          return { ok: false, error: "Feed is too large to import." };
        }
        out += decoder.decode(value, { stream: true });
      }
      out += decoder.decode();
      text = out;
    } else {
      text = await res.text();
    }

    if (!/BEGIN:VCALENDAR/i.test(text)) {
      return { ok: false, error: "That doesn't look like a calendar (.ics) feed." };
    }

    const now = Date.now();
    const windows = parseIcs(text, { from: now - 30 * DAY_MS, to: now + 400 * DAY_MS, tz });
    return { ok: true, windows };
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return { ok: false, error: "Feed took too long to respond." };
    }
    return { ok: false, error: "Could not reach that calendar feed." };
  }
}

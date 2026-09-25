import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";
import { isPrivateHost } from "@/lib/auth-redirect";
import { DAY_MS, parseIcs, type AvailWindow } from "@/lib/venue-availability";

/**
 * Server-only fetch of a venue's external .ics feed. Kept separate from the
 * pure engine (venue-availability.ts) — that file is client-bundle-safe by
 * design, and `fetch`-ing an admin-typed URL server-side has its own SSRF
 * guard that doesn't belong in a module a browser also loads.
 *
 * The guard has three layers, because an admin-typed URL is untrusted input
 * fetched FROM the server (classic SSRF surface), not something the guard
 * only has to be right about once:
 *   1. scheme + literal-host check on the URL text itself (sync, no I/O) —
 *      catches `http://127.0.0.1`, `http://2130706433` (WHATWG's own URL
 *      parser normalizes decimal/octal/hex IPv4 literals to dotted form
 *      before we ever see `hostname`), `http://[::1]`, `file:`, etc.
 *   2. DNS resolution of whatever hostname survives step 1 — catches a
 *      public-looking hostname whose A/AAAA records point at a private
 *      range (DNS rebinding).
 *   3. the SAME two checks re-applied to every redirect hop — `redirect:
 *      "manual"` plus our own loop, so a 302 to a private address can't
 *      walk straight past a guard that only ever looked at the first URL.
 */

const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_REDIRECTS = 3;

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

/* ---------------- literal-address classification (pure, no I/O) ---------------- */

/** IPv4 reserved/private ranges relevant to SSRF: loopback, "this network",
 *  link-local (incl. the cloud metadata address), the three RFC1918
 *  private blocks, and the RFC6598 carrier-grade NAT range. */
export function isPrivateOrReservedIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local incl. metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

/** Parse an IPv6 literal (no brackets) into 8 16-bit groups, expanding a
 *  single "::" run and an optional trailing dotted-IPv4 tail
 *  (e.g. "::ffff:127.0.0.1"). Returns null if it isn't a well-formed IPv6
 *  literal at all — callers of isPrivateOrReservedIPv6 treat that as "not
 *  a recognizable private address" (a genuine DNS AAAA result is always
 *  well-formed; this only has to be honest about literals a URL/DNS
 *  answer can actually produce). */
function parseIPv6Groups(raw: string): number[] | null {
  let ip = raw.trim();
  if (!ip || ip.indexOf(":") < 0) return null;

  let ipv4Tail: number[] | null = null;
  const lastColon = ip.lastIndexOf(":");
  const tail = ip.slice(lastColon + 1);
  if (tail.includes(".")) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(tail);
    if (!m) return null;
    const bytes = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (bytes.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    ipv4Tail = [(bytes[0] << 8) | bytes[1], (bytes[2] << 8) | bytes[3]];
    ip = ip.slice(0, lastColon);
  }

  const parts = ip.split("::");
  if (parts.length > 2) return null;

  const parseHexGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const segs = s.split(":");
    const out: number[] = [];
    for (const seg of segs) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(seg)) return null;
      out.push(parseInt(seg, 16));
    }
    return out;
  };

  if (parts.length === 1) {
    const groups = parseHexGroups(parts[0]);
    if (!groups) return null;
    const all = ipv4Tail ? [...groups, ...ipv4Tail] : groups;
    return all.length === 8 ? all : null;
  }

  const head = parseHexGroups(parts[0]);
  const tailGroups = parseHexGroups(parts[1]);
  if (!head || !tailGroups) return null;
  const tailAll = ipv4Tail ? [...tailGroups, ...ipv4Tail] : tailGroups;
  const missing = 8 - head.length - tailAll.length;
  if (missing < 0) return null;
  return [...head, ...Array(missing).fill(0), ...tailAll];
}

/** ::1 (loopback), :: (unspecified), fc00::/7 (unique-local), fe80::/10
 *  (link-local), and an IPv4-mapped ::ffff:a.b.c.d whose embedded address
 *  is itself private/reserved. An unparsable literal is NOT flagged here —
 *  a well-formed-but-unrecognized address falls through to the caller's
 *  normal "public" treatment. */
export function isPrivateOrReservedIPv6(raw: string): boolean {
  const groups = parseIPv6Groups(raw);
  if (!groups) return false;
  if (groups.every((g) => g === 0)) return true; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff) {
    const a = (groups[6] >> 8) & 0xff;
    const b = groups[6] & 0xff;
    const c = (groups[7] >> 8) & 0xff;
    const d = groups[7] & 0xff;
    return isPrivateOrReservedIPv4(`${a}.${b}.${c}.${d}`);
  }
  return false;
}

/** Classify a bare IP literal (brackets already stripped) as
 *  private/reserved, dispatching on family. A non-IP string (an ordinary
 *  hostname) reads as false here — it still goes through DNS resolution
 *  separately. */
export function isPrivateOrReservedAddress(addr: string): boolean {
  const family = net.isIP(addr);
  if (family === 4) return isPrivateOrReservedIPv4(addr);
  if (family === 6) return isPrivateOrReservedIPv6(addr);
  return false;
}

/** `[::1]` -> `::1` — URL.hostname keeps an IPv6 literal bracketed;
 *  everything downstream (net.isIP, the IPv6 group parser, dns results)
 *  wants the bare address. */
function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/* ---------------- URL-level sync guard (no I/O) ---------------- */

/** Reject anything that isn't a plain http(s) URL, or whose HOSTNAME IS
 *  ITSELF a private/reserved IP literal (in ANY of the forms a URL parser
 *  will normalize for us — decimal, octal, hex, short-form IPv4; bracketed
 *  IPv6 incl. IPv4-mapped) or a private-shaped hostname (localhost,
 *  `.local`, an RFC1918 host auth-redirect.ts's `isPrivateHost` already
 *  recognizes). Pure — no DNS, no network — so every redirect hop can run
 *  it fresh via `resolveRedirectHop` below. */
export function validateIcsUrlSync(raw: string): { ok: true; url: string } | { ok: false; error: string } {
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
  const bareHost = stripBrackets(u.hostname);
  if (isPrivateHost(u.hostname) || isPrivateOrReservedAddress(bareHost)) {
    return { ok: false, error: "That host isn't reachable from the server." };
  }
  return { ok: true, url: u.toString() };
}

/** Resolve a redirect's `Location` header against the URL that produced
 *  it, and apply `validateIcsUrlSync` fresh — a relative Location is
 *  resolved to absolute first (`new URL` does this for us), so `../evil`
 *  or a bare `//127.0.0.1/x` are caught exactly like an absolute one.
 *  Pure/no I/O, exported so it (and the DNS layer above it) can each be
 *  spec-tested without a real server or DNS. */
export function resolveRedirectHop(location: string, base: string): { ok: true; url: string } | { ok: false; error: string } {
  let target: URL;
  try {
    target = new URL(location, base);
  } catch {
    return { ok: false, error: "Redirected to an unparsable URL." };
  }
  return validateIcsUrlSync(target.toString());
}

/* ---------------- DNS-resolution guard (I/O) ---------------- */

/** Does `hostname` resolve to (or literally name) a private/reserved
 *  address? A literal IP is classified directly, no DNS needed. An
 *  ordinary name is resolved via `dns/promises.lookup(..., {all:true})`
 *  and EVERY returned address is checked — one public + one private A/AAAA
 *  record is still a refusal (DNS rebinding doesn't get to pick which
 *  answer the guard happened to look at). A lookup failure fails CLOSED
 *  (treated as private/unsafe): the fetch would fail anyway, and "can't
 *  verify" is never treated as "safe". */
async function hostnameIsUnsafe(hostname: string): Promise<boolean> {
  const bare = stripBrackets(hostname);
  if (isPrivateOrReservedAddress(bare)) return true;
  if (net.isIP(bare)) return false; // a public literal IP — nothing to resolve
  try {
    const results = await dnsLookup(bare, { all: true, verbatim: true });
    return results.some((r) => isPrivateOrReservedAddress(r.address));
  } catch {
    return true;
  }
}

/** Backward-compatible export name some earlier code referenced directly;
 *  the real guard is `validateIcsUrlSync` + `hostnameIsUnsafe` combined.
 *  Kept async since it now also resolves DNS, unlike the sync guard above. */
export async function validateIcsUrl(raw: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const sync = validateIcsUrlSync(raw);
  if (!sync.ok) return sync;
  if (await hostnameIsUnsafe(new URL(sync.url).hostname)) {
    return { ok: false, error: "That host isn't reachable from the server." };
  }
  return sync;
}

/* ---------------- fetch + redirect loop + capped/timed body read ---------------- */

/**
 * Fetch + parse a venue's .ics feed for [now-30d, now+400d). Fails soft on
 * every error (bad URL, private/unresolvable host, timeout, non-calendar
 * body, oversized body, too many redirects) — returns `{ ok: false, error
 * }` rather than throwing, so a caller can always fall back to whatever
 * windows it already had.
 */
export async function fetchIcsWindows(rawUrl: string, tz?: string): Promise<IcsFetchResult> {
  const first = validateIcsUrlSync(rawUrl);
  if (!first.ok) return first;

  // One AbortController for the WHOLE operation (every redirect hop's
  // fetch() call, plus the body read afterward) — AbortSignal.timeout()
  // alone only covers a single fetch() call's own promise, not a
  // subsequent streamed body read, which is exactly the gap that let a
  // slow body evade the "5s timeout".
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let url = first.url;
    if (await hostnameIsUnsafe(new URL(url).hostname)) {
      return { ok: false, error: "That host isn't reachable from the server." };
    }

    let res: Response;
    for (let hop = 0; ; hop++) {
      res = await fetch(url, {
        headers: { Accept: "text/calendar, text/plain, */*", "User-Agent": "peak-app/1.0 (Peak Systems Group venue calendars)" },
        signal: controller.signal,
        redirect: "manual",
      });
      const isRedirect = res.status >= 300 && res.status < 400;
      const location = res.headers.get("location");
      if (!isRedirect || !location) break;
      if (hop >= MAX_REDIRECTS) return { ok: false, error: "Too many redirects." };
      const hopResult = resolveRedirectHop(location, url);
      if (!hopResult.ok) return hopResult;
      if (await hostnameIsUnsafe(new URL(hopResult.url).hostname)) {
        return { ok: false, error: "Redirected to a host that isn't reachable from the server." };
      }
      url = hopResult.url;
    }

    if (!res.ok) return { ok: false, error: `Feed returned HTTP ${res.status}.` };

    // Cap the body read so a misbehaving/huge feed can't hold the request
    // open indefinitely or blow up memory — read via the stream and ABORT
    // (not just stop reading) once the cap is exceeded, so the underlying
    // connection is actually torn down rather than left to drain.
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
          controller.abort();
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
    if (controller.signal.aborted) {
      return { ok: false, error: "Feed took too long to respond." };
    }
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return { ok: false, error: "Feed took too long to respond." };
    }
    return { ok: false, error: "Could not reach that calendar feed." };
  } finally {
    clearTimeout(timer);
  }
}

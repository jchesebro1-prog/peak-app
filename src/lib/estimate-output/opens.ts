/**
 * #301 slice B (D-o, R18) — how many times a client opened each sent
 * revision's package link. Pure and client-safe. `Quote.shareOpens` is
 * store-owned (recordShareOpen, under the row lock); everything that reads
 * it goes through cleanOpens, so a malformed doc never throws.
 */

export type ShareOpenStat = { first: number; last: number; count: number };
export type ShareOpens = Record<string, ShareOpenStat>;

/** One open per IP-hash per revision per 30 minutes (in-memory; see links.ts). */
export const SHARE_OPEN_DEDUPE_MS = 30 * 60_000;
export const MAX_OPEN_REVS = 100;
const MAX_COUNT = 1_000_000;
const REV_KEY = /^[1-9]\d{0,5}$/;

function statOf(v: unknown): ShareOpenStat | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const first = typeof o.first === "number" ? o.first : NaN;
  const last = typeof o.last === "number" ? o.last : NaN;
  const count = typeof o.count === "number" ? o.count : NaN;
  if (!(first > 0) || !(last >= first) || !Number.isSafeInteger(count) || count < 1) return null;
  return { first, last, count: Math.min(count, MAX_COUNT) };
}

export function cleanOpens(raw: unknown): ShareOpens {
  const out: ShareOpens = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!REV_KEY.test(k)) continue;
    const s = statOf(v);
    if (s) out[k] = s;
  }
  return out;
}

export function opensFor(raw: unknown, rev: number): ShareOpenStat | null {
  return cleanOpens(raw)[String(rev)] ?? null;
}

/** shareOpens after one more open of `rev` at `now`; null = nothing to write. */
export function nextOpens(prev: unknown, rev: number, now: number): ShareOpens | null {
  if (!Number.isSafeInteger(rev) || rev < 1 || rev > 999_999 || !Number.isFinite(now) || now <= 0) return null;
  const cur = cleanOpens(prev);
  const key = String(rev);
  const s = cur[key];
  if (!s && Object.keys(cur).length >= MAX_OPEN_REVS) return null;
  cur[key] = s ? { first: s.first, last: Math.max(s.last, now), count: Math.min(s.count + 1, MAX_COUNT) } : { first: now, last: now, count: 1 };
  return cur;
}

const shortDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });

/** "opened 3× · first Oct 5 · last Oct 6" | "not opened yet". */
export function opensSummary(s: ShareOpenStat | null): string {
  if (!s) return "not opened yet";
  return `opened ${s.count}× · first ${shortDate(s.first)} · last ${shortDate(s.last)}`;
}

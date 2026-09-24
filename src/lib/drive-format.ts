/**
 * Drive-distance cell formatting + sorting (#176, D229). Pure and
 * client-safe — imports nothing — so server pages and client components can
 * both use it. The numbers come from lib/travel-bulk.ts.
 */
export type DriveSource = "manual" | "routed" | "auto" | "none";
export type Drive = { miles: number | null; minutes: number | null; source: DriveSource };
export type DriveSort = "near" | "far";

function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h <= 0) return m + "m";
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "62 mi · 1h 8m"; "~" prefix when it is a straight-line estimate; "—" when unlocated. */
export function fmtDrive(d: Drive | null | undefined): string {
  if (!d || d.source === "none" || d.miles == null) return "—";
  const mi = Math.round(d.miles).toLocaleString("en-US") + " mi";
  const t = d.minutes == null ? "" : " · " + fmtMinutes(d.minutes);
  return (d.source === "auto" ? "~" : "") + mi + t;
}

/** Hover text explaining where a cell's number came from. */
export function driveTitle(d: Drive | null | undefined): string {
  if (!d || d.source === "none" || d.miles == null)
    return "Not located — fix it in Settings → Admin";
  if (d.source === "auto") return "Estimated — run Geocode addresses to fetch the real route";
  if (d.source === "manual") return "Manual travel override";
  return "Driving route";
}

export function parseDriveSort(v: string | null | undefined): DriveSort | "" {
  return v === "near" || v === "far" ? v : "";
}

/**
 * Order two drives nearest- or farthest-first by minutes, then miles.
 * Unlocated ("none"/null) always sorts LAST in both directions. Returns 0 on
 * a full tie so the caller can break it by name.
 */
export function compareDrive(
  a: Drive | null | undefined,
  b: Drive | null | undefined,
  dir: DriveSort
): number {
  const has = (d: Drive | null | undefined): d is Drive =>
    !!d && d.source !== "none" && d.miles != null;
  if (!has(a) && !has(b)) return 0;
  if (!has(a)) return 1;
  if (!has(b)) return -1;
  const sign = dir === "far" ? -1 : 1;
  const am = a.minutes ?? Infinity;
  const bm = b.minutes ?? Infinity;
  if (am !== bm) return sign * (am - bm);
  if (a.miles !== b.miles) return sign * ((a.miles as number) - (b.miles as number));
  return 0;
}

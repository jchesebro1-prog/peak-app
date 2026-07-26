/**
 * Shared formatting helpers — prototype display conventions.
 * All inputs are epoch-ms numbers (the app-wide timestamp convention).
 */

export function money(n: number | null | undefined, opts: { cents?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  });
}

export function shortDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fullDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function dateYear(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function timeAgo(ms: number | null | undefined): string {
  if (!ms) return "—";
  const deltaMs = Date.now() - ms;
  // Future branch (reviewer fix, #21 — scheduled/Upcoming timestamps):
  // mirrors the past thresholds below but only needs m/h/d — feed items
  // land within days, never months/years out. |delta| < 1 min still reads
  // "just now" regardless of direction.
  if (deltaMs < 0) {
    const fs = Math.floor(-deltaMs / 1000);
    if (fs < 60) return "just now";
    const fm = Math.floor(fs / 60);
    if (fm < 60) return `in ${fm}m`;
    const fh = Math.floor(fm / 60);
    if (fh < 24) return `in ${fh}h`;
    const fd = Math.floor(fh / 24);
    return `in ${fd}d`;
  }
  const s = Math.max(0, Math.floor(deltaMs / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function daysUntil(ms: number | null | undefined): number | null {
  if (!ms) return null;
  return Math.round((ms - Date.now()) / 86400000);
}

export function waitLabel(hours: number): string {
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * #323 — pure helpers shared by the Meetings loaders (server) and the box /
 * reader (client): tab parsing, link building, labels. No imports with side
 * effects — safe in the client bundle.
 */
import type { WorkType } from "@/lib/meetings/types";

export type MeetingsTab = "to-file" | "filed" | "noise";

export const MEETINGS_TABS: MeetingsTab[] = ["to-file", "filed", "noise"];

/** Where the Meetings box lives today; a later nav page passes its own base (K7). */
export const MEETINGS_BASE_HREF = "/inbox?view=meetings";

/** Cap on the Filed tab's list. */
export const FILED_CAP = 200;

export function meetingsTabOf(v: string | null | undefined): MeetingsTab {
  return v === "filed" || v === "noise" ? v : "to-file";
}

/** `base` may already carry a query (`/inbox?view=meetings`) or not (`/meetings`). */
export function meetingsHref(base: string, tab: MeetingsTab, id?: string | null): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}tab=${tab}${id ? `&m=${encodeURIComponent(id)}` : ""}`;
}

export const WORK_TYPE_LABEL: Record<WorkType, string> = {
  lead: "Lead", site_visit: "Site visit", survey: "Survey", project: "Project", engagement: "Engagement", quote: "Quote",
};

export function lengthLabel(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${Math.max(0, Math.round(sec))} s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

export function agoLabel(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** The box tab a meeting lists under — a deep link opens its reader over the right list. */
export function meetingTabFor(m: { filedAt: number | null; noise: boolean }): MeetingsTab {
  return m.noise ? "noise" : m.filedAt ? "filed" : "to-file";
}

/** `/inbox?view=meetings&tab=<its tab>&m=<id>` — the reader deep link record cards, the feed and ⌘K use. */
export function meetingReaderHref(m: { id: string; filedAt: number | null; noise: boolean }): string {
  return meetingsHref(MEETINGS_BASE_HREF, meetingTabFor(m), m.id);
}

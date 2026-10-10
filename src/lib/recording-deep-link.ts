/**
 * `/recordings/[id]?tab=…&seg=…` — the morning-triage call line links to the
 * exact transcript segment a to-do came from. Pure, client-safe.
 */
export const RECORDING_TABS = ["summary", "actions", "transcript", "audio"] as const;
export type RecordingTab = (typeof RECORDING_TABS)[number];

export function parseRecordingDeepLink(sp: Record<string, string | string[] | undefined>): { tab: RecordingTab; seg: number | null } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const rawSeg = one(sp.seg);
  const seg = rawSeg != null && /^\d{1,6}$/.test(rawSeg) ? Number(rawSeg) : null;
  const t = one(sp.tab) || "";
  const tab: RecordingTab = seg != null ? "transcript" : (RECORDING_TABS as readonly string[]).includes(t) ? (t as RecordingTab) : "summary";
  return { tab, seg };
}

/**
 * How many transcript segments to render at first: one page, or enough to
 * include the linked segment (the page renders only the first N of the FULL
 * segments array, and `seg` indexes that full array).
 */
export function initialTranscriptShown(focusSeg: number | null, page: number): number {
  return Math.max(page, (focusSeg ?? -1) + 1);
}

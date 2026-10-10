import { tokens } from "./text";

/**
 * Spec "Transcript line match" — score each segment by the share of the
 * to-do's (unique, stopword-free) tokens it contains. Best segment with
 * share ≥ 0.5 AND ≥ 2 matched tokens wins; ties → more matched tokens →
 * earlier segment. Pure, client-safe.
 */
export type TranscriptSegment = { speaker: number; text: string; start: number; end: number };
export type LineMatch = { index: number; speaker: number; text: string; start: number; share: number; matched: number };

export const MATCH_MIN_SHARE = 0.5;
export const MATCH_MIN_TOKENS = 2;

export function matchTranscriptLine(title: string, segments: readonly TranscriptSegment[]): LineMatch | null {
  const want = new Set(tokens(title));
  if (want.size < MATCH_MIN_TOKENS) return null;
  let best: LineMatch | null = null;
  for (let index = 0; index < segments.length; index++) {
    const s = segments[index];
    const have = new Set(tokens(String(s?.text ?? "")));
    let matched = 0;
    for (const w of want) if (have.has(w)) matched++;
    const share = matched / want.size;
    if (!best || share > best.share || (share === best.share && matched > best.matched)) {
      best = { index, speaker: Number(s.speaker) || 0, text: String(s.text ?? ""), start: Number(s.start) || 0, share, matched };
    }
  }
  return best && best.share >= MATCH_MIN_SHARE && best.matched >= MATCH_MIN_TOKENS ? best : null;
}

/** Seconds → "12:34" or "1:02:05". */
export function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function clipLine(text: string, max = 140): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

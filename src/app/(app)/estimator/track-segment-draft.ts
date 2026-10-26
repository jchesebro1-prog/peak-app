import { pathLengthFt, type TrackSegment } from "@/lib/track-path";
import type { TrackSegmentDraft } from "./types";

/**
 * #369 — the track configurator's segment rows ↔ a track path, the arc-length
 * helpers, and the four shape presets. Pure.
 */

const RAD = Math.PI / 180;
/** Blank → NaN (the engine names the segment); otherwise Number(). */
const numOf = (s: string) => {
  const t = (s ?? "").trim();
  return t === "" ? NaN : Number(t);
};
const r1 = (n: number) => Math.round(n * 10) / 10;
/** Form text: up to 4 decimals, "" when not a number. */
const txt = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 10000) / 10000) : "");

export function blankSegment(kind: "straight" | "arc"): TrackSegmentDraft {
  return { kind, length: "", radius: "", angle: "", turn: "left" };
}

export function segmentsToPath(segs: readonly TrackSegmentDraft[]): TrackSegment[] {
  return segs.map((s) =>
    s.kind === "straight"
      ? { kind: "straight", lengthFt: numOf(s.length) }
      : { kind: "arc", radiusFt: numOf(s.radius), sweepDeg: numOf(s.angle), turn: s.turn === "right" ? "right" : "left" }
  );
}

export function pathToSegments(path: readonly TrackSegment[]): TrackSegmentDraft[] {
  return path.map((s) =>
    s.kind === "straight" ? { ...blankSegment("straight"), length: txt(s.lengthFt) } : { ...blankSegment("arc"), radius: txt(s.radiusFt), angle: txt(s.sweepDeg), turn: s.turn }
  );
}

const twoDp = (n: number) => String(Math.round(n * 100) / 100);

/** "9.42" — an arc row's length, "" until radius and angle are numbers. */
export function arcLengthText(seg: TrackSegmentDraft): string {
  const r = numOf(seg.radius);
  const a = numOf(seg.angle);
  return r > 0 && a > 0 ? twoDp(r * a * RAD) : "";
}

/** The angle for a typed arc length at the row's radius; "" when either is missing. */
export function angleFromArcLength(lengthText: string, radiusText: string): string {
  const l = numOf(lengthText);
  const r = numOf(radiusText);
  return l > 0 && r > 0 ? txt(l / r / RAD) : "";
}

/** The angle text after the user types `lengthText` into an arc row's length box: the back-solved angle when length and radius are both positive numbers, else the row's current angle unchanged (a half-typed "9." or "0." never clears it). */
export function angleAfterArcLengthEdit(lengthText: string, seg: TrackSegmentDraft): string {
  const next = angleFromArcLength(lengthText, seg.radius);
  return next === "" ? seg.angle : next;
}

/** "33.42" — the rows' total, "" when any row is incomplete or there are none. */
export function totalRunText(segs: readonly TrackSegmentDraft[]): string {
  if (!segs.length) return "";
  const L = pathLengthFt(segmentsToPath(segs));
  return Number.isFinite(L) && L > 0 ? twoDp(L) : "";
}

export type TrackPresetId = "single" | "legs" | "u" | "serpentine";
export const TRACK_PRESETS: ReadonlyArray<{ id: TrackPresetId; label: string }> = [
  { id: "single", label: "Single arc" },
  { id: "legs", label: "Arc with straight legs" },
  { id: "u", label: "U wrap" },
  { id: "serpentine", label: "Serpentine" },
];
const PRESET_RUN_FT = 40;
const U_CORNER_FT = 2;

/** A preset's rows sized to `runFt` (40' when blank), never tighter than the series minimum. Editable after. */
export function presetSegments(id: TrackPresetId, runFt: number, minRadiusFt?: number): TrackSegmentDraft[] {
  const run = Number.isFinite(runFt) && runFt > 0 ? runFt : PRESET_RUN_FT;
  const rMin = minRadiusFt && minRadiusFt > 0 ? minRadiusFt : 0;
  const straight = (l: number): TrackSegmentDraft => ({ ...blankSegment("straight"), length: txt(r1(l)) });
  // radius ≥ length / π keeps one arc at most 180°
  const arc = (l: number, turn: "left" | "right", radius = Math.max(rMin, l / Math.PI)): TrackSegmentDraft => {
    const r = r1(radius);
    return { ...blankSegment("arc"), radius: txt(r), angle: txt(r1(l / r / RAD)), turn };
  };
  switch (id) {
    case "single":
      return [arc(run, "left")];
    case "legs":
      return [straight(run * 0.25), arc(run * 0.5, "left"), straight(run * 0.25)];
    case "u": {
      const r = r1(Math.max(rMin, U_CORNER_FT));
      const corner = (): TrackSegmentDraft => ({ ...blankSegment("arc"), radius: txt(r), angle: "90", turn: "left" });
      const middle = Math.max(run * 0.5 - Math.PI * r, run * 0.25);
      return [straight(run * 0.25), corner(), straight(middle), corner(), straight(run * 0.25)];
    }
    case "serpentine": {
      const radius = Math.max(rMin, run / 2 / (Math.PI / 2));
      return [arc(run / 2, "left", radius), arc(run / 2, "right", radius)];
    }
  }
}

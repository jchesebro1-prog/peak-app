// src/lib/design/room-shape/spaces.ts
import { clamp01, type Point } from "@/lib/annotations";
import { outlinePoints } from "./geometry";
import type { RoomShape, SheetFrame, ShapePt } from "./types";

/** #370: feet → the sheet's normalized 0..1 (clamped), and back. */
export const toSheet = (p: ShapePt, f: SheetFrame): Point => ({ x: clamp01((p.x - f.minX) / f.wFt), y: clamp01((p.y - f.minY) / f.hFt) });
export const fromSheet = (p: Point, f: SheetFrame): ShapePt => ({ x: f.minX + p.x * f.wFt, y: f.minY + p.y * f.hFt });

/** The sheet's calibration scale (feet per normalized sheet width — calibrationScale over (0,0)–(1,0)). */
export const frameScale = (f: SheetFrame): number => f.wFt;

/** #370: one Space per room and zone, in shape order, named as on the plan and tagged with its room. */
export function shapeSpaces(shape: RoomShape, frame: SheetFrame, sheetId: string): Array<{ sheetId: string; page: 1; name: string; points: Point[]; fromRoom: string }> {
  return shape.rooms.map((r) => ({ sheetId, page: 1 as const, name: r.name, points: outlinePoints(r, 0.5, 64).map((p) => toSheet(p, frame)), fromRoom: r.id }));
}

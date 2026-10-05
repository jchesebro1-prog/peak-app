/** #299 — The Grid toolbar's tool model. The editor still keeps its separate
 *  mode flags (armed part, drawing modes…); this derives the one active tool
 *  from them, in a fixed priority, so the toolbar can never show two. */
export type GridTool = "select" | "place" | "curtain" | "wire" | "space" | "calibrate" | "pan";
export type ModeFlags = {
  armedPartId: string | null;
  armedCurtainType: string | null;
  wireDrawing: boolean;
  spaceDrawing: boolean;
  calibrating: boolean;
  panning: boolean;
};

export function activeTool(m: ModeFlags): GridTool {
  if (m.calibrating) return "calibrate";
  if (m.spaceDrawing) return "space";
  if (m.wireDrawing) return "wire";
  if (m.armedCurtainType) return "curtain";
  if (m.armedPartId) return "place";
  if (m.panning) return "pan";
  return "select";
}

export const TOOL_KEYS: Record<string, GridTool> = { v: "select", p: "place", w: "wire", s: "space", h: "pan" };

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

export function fitZoom(container: { w: number; h: number }, sheetPx: { w: number; h: number }, zoom: number): number {
  if (!(container.w > 0) || !(container.h > 0) || !(sheetPx.w > 0) || !(sheetPx.h > 0) || !(zoom > 0)) return zoom;
  const nw = sheetPx.w / zoom;
  const nh = sheetPx.h / zoom;
  const fit = Math.min(container.w / nw, container.h / nh) * 0.96;
  const snapped = Math.floor(fit / 0.05) * 0.05;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(snapped * 100) / 100));
}

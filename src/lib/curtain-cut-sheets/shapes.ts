/** Curtain cut sheets (#292) — drawing primitives. Pure data; components/cutsheets/shape-svg draws them. */
export type Stroke = "thin" | "med" | "heavy";
export type Fill = "none" | "tone" | "hatch" | "solid";
type Tagged = { tag?: "panel" | "pleat" | "mark" | "dim" | "band" };
export type Shape = Tagged &
  (
    | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke?: Stroke; dash?: boolean }
    | { kind: "rect"; x: number; y: number; w: number; h: number; stroke?: Stroke; fill?: Fill; dash?: boolean }
    | { kind: "circle"; cx: number; cy: number; r: number; stroke?: Stroke; fill?: Fill }
    | { kind: "path"; d: string; stroke?: Stroke; fill?: Fill; dash?: boolean }
    | { kind: "text"; x: number; y: number; text: string; size: number; anchor?: "start" | "middle" | "end"; bold?: boolean; rotate?: number }
  );
/** A plain-language callout; "\n" breaks lines. */
export type ShapeLabel = { x: number; y: number; text: string; anchor?: "start" | "end"; leaderTo?: [number, number] };

/**
 * Symbol display rules: scale and mode for Grid object symbols.
 * Pure module — no side effects, no DB access, testable in isolation.
 */

export type SymbolMode = "generic" | "object";

export type SymbolDisplay = {
  scale: number;
  mode: SymbolMode;
};

export const SYMBOL_SCALE_MIN = 0.25;
export const SYMBOL_SCALE_MAX = 4;
export const SYMBOL_SCALE_STEP = 0.05;

export const DEFAULT_SYMBOL_DISPLAY: SymbolDisplay = {
  scale: 1,
  mode: "generic",
};

/**
 * Clean and normalize a symbol display config.
 * - Non-objects or null → DEFAULT_SYMBOL_DISPLAY
 * - scale: finite → clamp to [MIN, MAX] → round to STEP → round to 2 decimals; else 1
 * - mode: "object" → "object"; anything else → "generic"
 */
export function cleanSymbolDisplay(raw: unknown): SymbolDisplay {
  if (typeof raw !== "object" || raw === null) {
    return { ...DEFAULT_SYMBOL_DISPLAY };
  }

  const obj = raw as Record<string, unknown>;

  // Clean scale
  let scale = 1;
  if (typeof obj.scale === "number" && Number.isFinite(obj.scale)) {
    // Clamp to min/max
    let clamped = Math.max(SYMBOL_SCALE_MIN, Math.min(SYMBOL_SCALE_MAX, obj.scale));
    // Round to step
    clamped = Math.round(clamped / SYMBOL_SCALE_STEP) * SYMBOL_SCALE_STEP;
    // Round to 2 decimal places
    scale = Math.round(clamped * 100) / 100;
  }

  // Clean mode
  const mode: SymbolMode = obj.mode === "object" ? "object" : "generic";

  return { scale, mode };
}

export const DEFAULT_MARKER = { w: 44, h: 30 } as const;

/**
 * Compute marker box dimensions, scaling the symbol by the given scale.
 * Falls back to DEFAULT_MARKER if part is null/undefined or lacks dimensions.
 * Bad scale (NaN, etc.) is cleaned to 1.
 */
export function markerBox(
  part: { symbolWidth?: number; symbolHeight?: number } | null | undefined,
  scale: number
): { w: number; h: number } {
  // Clean scale using cleanSymbolDisplay
  const cleanedDisplay = cleanSymbolDisplay({ scale });
  const cleanedScale = cleanedDisplay.scale;

  const width = part?.symbolWidth || DEFAULT_MARKER.w;
  const height = part?.symbolHeight || DEFAULT_MARKER.h;

  return {
    w: width * cleanedScale,
    h: height * cleanedScale,
  };
}

/**
 * Compute hit radius for a symbol, scaling by the given scale.
 * Clamps scale to at least 0.5 to keep tiny symbols grabbable.
 * Returns: base × max(0.5, cleanedScale), rounded to 6 decimals.
 */
export function hitRadius(base: number, scale: number): number {
  // Clean scale using cleanSymbolDisplay
  const cleanedDisplay = cleanSymbolDisplay({ scale });
  const cleanedScale = cleanedDisplay.scale;

  // Use max of 0.5 and the cleaned scale
  const effectiveScale = Math.max(0.5, cleanedScale);

  // Multiply base by effective scale
  const result = base * effectiveScale;

  // Round to 6 decimal places
  return Math.round(result * 1e6) / 1e6;
}

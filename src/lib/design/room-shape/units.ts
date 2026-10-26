// src/lib/design/room-shape/units.ts
/** #370: "42'-6\"", "42' 6\"", "42'", "42.5", "6\"" → feet, rounded to the inch; null for anything else or ≤ 0. */
export function parseFeet(text: string): number | null {
  const t = String(text ?? "").trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  let m: RegExpExecArray | null;
  let ft: number;
  if ((m = /^(\d+(?:\.\d+)?)\s*'?$/.exec(t))) ft = Number(m[1]);
  else if ((m = /^(\d+(?:\.\d+)?)\s*'\s*-?\s*(\d+(?:\.\d+)?)\s*"?$/.exec(t))) ft = Number(m[1]) + Number(m[2]) / 12;
  else if ((m = /^(\d+(?:\.\d+)?)\s*"$/.exec(t))) ft = Number(m[1]) / 12;
  else return null;
  const r = Math.round(ft * 12) / 12;
  return Number.isFinite(r) && r > 0 ? r : null;
}

/** Feet as 42'-6" (whole inches). */
export function fmtFeet(ft: number): string {
  const inches = Math.round(Math.abs(ft) * 12);
  return `${ft < 0 && inches > 0 ? "-" : ""}${Math.floor(inches / 12)}'-${inches % 12}"`;
}

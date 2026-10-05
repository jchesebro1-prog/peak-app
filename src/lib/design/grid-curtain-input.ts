import { get as getPart } from "@/lib/stores/catalog";
import { GRID_CURTAIN_TYPES, GRID_FULLNESS, type GridCurtain } from "@/lib/design/grid-bom";
import { isFabricRow } from "@/lib/design/grid-curtains";
import { cleanCurtainFinishes } from "@/lib/curtain-cut-sheets/vocab";

// Server-only (the `server-only` package isn't installed here): fail loudly
// if a client bundle ever pulls this catalog-backed check in.
if (typeof window !== "undefined") throw new Error("grid-curtain-input is server-only");

/** A curtain as the drop dialog (or a paste / undo) sends it — unchecked. */
export type CurtainInput = {
  type: string;
  name: string;
  widthFt: number;
  heightFt: number;
  fullnessPct: number;
  fabricSku: string;
  color?: string;
  /** Spec records design §6 — optional system match key override. */
  specKey?: string;
  /** #292 — cut-sheet finishes + mount; bad or absent values drop, never refuse. */
  topFinish?: string;
  bottomFinish?: string;
  mountType?: string;
};

/** Sanity ceiling on a drape dimension, in feet - a typo like 400 for 40 would
 *  otherwise quote five figures of fabric without a murmur. */
export const MAX_CURTAIN_FT = 300;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Every check and normalisation a placed curtain goes through (punch #49),
 * shared by placeCurtainAction, paste and undo (#299) so a curtain can't
 * reach the plan by a looser path. Moved verbatim out of placeCurtainAction;
 * the only additions are type guards, so a non-string field from a tampered
 * request refuses instead of throwing. The fabric rate and the money come
 * from the catalog here and at quote time — never from the client.
 */
export async function checkCurtainInput(
  c: CurtainInput
): Promise<{ ok: true; curtain: GridCurtain } | { ok: false; error: string }> {
  if (!c || typeof c !== "object" || !(GRID_CURTAIN_TYPES as readonly string[]).includes(c.type))
    return { ok: false, error: "Pick a curtain type: Border, Draw, Full or Leg." };
  const name = str(c.name).trim();
  if (!name) return { ok: false, error: "Name the curtain: 'Main Grand Drape', 'US Border'…" };
  const width = Number(c.widthFt);
  const height = Number(c.heightFt);
  if (!(width > 0) || !(height > 0))
    return { ok: false, error: "Width and height must both be positive numbers of feet." };
  if (width > MAX_CURTAIN_FT || height > MAX_CURTAIN_FT)
    return { ok: false, error: `That drape is over ${MAX_CURTAIN_FT} ft, check the dimensions.` };
  if (!GRID_FULLNESS.some((f) => f.pct === Number(c.fullnessPct)))
    return { ok: false, error: "Fullness must be Flat, 50%, 75% or 100%." };
  const fabric = await getPart(str(c.fabricSku));
  if (!fabric || !isFabricRow(fabric))
    return { ok: false, error: "Pick a fabric from the catalog's fabric rows." };

  const curtain: GridCurtain = {
    type: c.type as GridCurtain["type"],
    name: name.slice(0, 80),
    widthFt: width,
    heightFt: height,
    fullnessPct: Number(c.fullnessPct),
    fabricSku: fabric.id,
    color: str(c.color).trim().slice(0, 40) || undefined,
    specKey: (typeof c.specKey === "string" ? c.specKey : "").trim().slice(0, 120) || undefined,
    ...cleanCurtainFinishes(c),
  };
  return { ok: true, curtain };
}

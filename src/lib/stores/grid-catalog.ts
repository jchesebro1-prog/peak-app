import { list as listPricingCatalog, type CatalogPart } from "@/lib/stores/catalog";
import { listDocs, patchDoc, softDeleteDoc, upsertDoc, insertWithPrefixedId } from "@/db/doc-store";
import type { Port } from "@/lib/catalog-connect";
import type { GridShape } from "@/lib/design/grid-symbols";

/**
 * Grid's symbol library is intentionally separate from the pricing catalog.
 * A symbol can exist without a price-book row; `pricingPartId` is only an
 * optional bridge used when a design is turned into a quote.
 */
export type GridAssemblyMember = {
  symbolId: string;
  qty: number;
  x: number;
  y: number;
};

export type GridSymbol = {
  id: string;
  name: string;
  manufacturer: string;
  modelNumber: string;
  scope: string;
  category: string;
  width: number;
  height: number;
  ports: Port[];
  pricingPartId?: string | null;
  /** Legacy per-entry D154 shape (#131). Still honoured as a fallback by
   *  symbolLook (lib/design/grid-icons): `icon` below wins over it. */
  shape?: GridShape | null;
  /** Per-entry stock-symbol overrides (spec 2026-09-25). `icon` is a
   *  grid-icons id and wins over `shape`; `color` is "#rrggbb" and wins over
   *  the group/trade colour. Absent/null = the resolved defaults. */
  icon?: string | null;
  color?: string | null;
  kind?: "device" | "assembly";
  members?: GridAssemblyMember[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

function scopeFor(p: CatalogPart): string {
  const text = `${p.category} ${p.desc} ${p.discipline || ""}`.toLowerCase();
  if (text.includes("curtain") || text.includes("fabric")) return "Curtains";
  if (text.includes("rig") || text.includes("truss")) return "Rigging";
  if (text.includes("video") || text.includes("sdi") || text.includes("hdmi")) return "Video";
  if (text.includes("audio") || text.includes("speaker") || text.includes("microphone")) return "Audio";
  return "Lighting";
}

function dimensionsFor(p: CatalogPart): { width: number; height: number } {
  const text = `${p.category} ${p.desc}`.toLowerCase();
  if (text.includes("speaker") || text.includes("fixture")) return { width: 48, height: 34 };
  if (text.includes("rack") || text.includes("control")) return { width: 54, height: 38 };
  return { width: 44, height: 30 };
}

function fromPricing(p: CatalogPart, by: string): GridSymbol {
  const d = dimensionsFor(p);
  return {
    id: p.id,
    name: p.desc,
    manufacturer: p.mfr || "",
    modelNumber: p.sku,
    scope: scopeFor(p),
    category: p.category || "Other",
    width: d.width,
    height: d.height,
    ports: p.ports || [],
    pricingPartId: p.id,
    kind: "device",
    createdBy: by,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** Load the independent Grid library, seeding only placeable pricing rows on first use. */
export async function listGridSymbols(seedBy = "system"): Promise<GridSymbol[]> {
  const existing = await listDocs<GridSymbol>("grid_catalog");
  if (existing.length) return existing.sort((a, b) => a.name.localeCompare(b.name));
  const pricing = await listPricingCatalog();
  const seed = pricing
    .filter((p) => p.category !== "Fabric" && p.category !== "Labor")
    .map((p) => fromPricing(p, seedBy));
  if (!seed.length) {
    const t = Date.now();
    seed.push(
      { id: "GRID-LGT-PANEL", name: "Lighting control / fixture", manufacturer: "", modelNumber: "GRID-LGT-PANEL", scope: "Lighting", category: "Fixture", width: 48, height: 34, ports: [{ name: "DMX in", direction: "in", connectionType: "DMX512 (5-pin XLR)" }, { name: "DMX thru", direction: "out", connectionType: "DMX512 (5-pin XLR)" }], kind: "device", createdBy: seedBy, createdAt: t, updatedAt: t },
      { id: "GRID-AUD-SPEAKER", name: "Speaker", manufacturer: "", modelNumber: "GRID-AUD-SPEAKER", scope: "Audio", category: "Speakers", width: 48, height: 34, ports: [{ name: "Audio in", direction: "in", connectionType: "speakON NL4" }], kind: "device", createdBy: seedBy, createdAt: t, updatedAt: t },
      { id: "GRID-VID-DISPLAY", name: "Video display", manufacturer: "", modelNumber: "GRID-VID-DISPLAY", scope: "Video", category: "Video", width: 54, height: 38, ports: [{ name: "SDI in", direction: "in", connectionType: "SDI/BNC" }, { name: "SDI out", direction: "out", connectionType: "SDI/BNC" }], kind: "device", createdBy: seedBy, createdAt: t, updatedAt: t },
      { id: "GRID-RIG-MOTOR", name: "Rigging motor", manufacturer: "", modelNumber: "GRID-RIG-MOTOR", scope: "Rigging", category: "Rigging", width: 44, height: 30, ports: [{ name: "Motor power", direction: "in", connectionType: "motor power" }], kind: "device", createdBy: seedBy, createdAt: t, updatedAt: t },
    );
  }
  for (const symbol of seed) await upsertDoc<GridSymbol>("grid_catalog", symbol);
  return seed.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getGridSymbol(id: string): Promise<GridSymbol | null> {
  const symbols = await listGridSymbols();
  return symbols.find((s) => s.id === id) || null;
}

export async function createGridAssembly(input: {
  name: string;
  manufacturer: string;
  modelNumber: string;
  scope: string;
  members: GridAssemblyMember[];
  shape?: GridShape | null;
  by: string;
}): Promise<GridSymbol> {
  const t = Date.now();
  return insertWithPrefixedId<GridSymbol>("grid_catalog", "GASM", 1, (id) => ({
    id,
    name: input.name.trim() || "Untitled assembly",
    manufacturer: input.manufacturer.trim(),
    modelNumber: input.modelNumber.trim() || id,
    scope: input.scope || "Unscoped",
    category: "Assembly",
    width: 74,
    height: 52,
    ports: [],
    kind: "assembly",
    members: input.members,
    shape: input.shape ?? null,
    createdBy: input.by,
    createdAt: t,
    updatedAt: t,
  }));
}

/** Delete a user-created assembly (soft delete). Refuses a seeded device
 *  symbol — listGridSymbols only re-seeds when the WHOLE collection is
 *  empty, which a lone assembly delete never causes (the seeded devices
 *  stay), but the guard keeps this from ever being reachable for them even
 *  if a caller skips the UI's own kind==="assembly" filter. */
export async function removeGridAssembly(
  id: string
): Promise<{ ok: true } | { ok: false; reason: "not-found" | "not-an-assembly" }> {
  const symbol = await getGridSymbol(id);
  if (!symbol) return { ok: false, reason: "not-found" };
  if (symbol.kind !== "assembly") return { ok: false, reason: "not-an-assembly" };
  await softDeleteDoc("grid_catalog", id);
  return { ok: true };
}

/** Set or clear (null) one entry's symbol override (#131). Returns null when
 *  the entry doesn't exist in the Grid library. */
export async function setGridSymbolShape(
  id: string,
  shape: GridShape | null
): Promise<GridSymbol | null> {
  return patchDoc<GridSymbol>("grid_catalog", id, (d) => {
    d.shape = shape;
    d.updatedAt = Date.now();
  });
}

/** Set or clear (null) one entry's stock-symbol icon and/or colour (spec
 *  2026-09-25). Only the keys present in `look` change. Setting or clearing
 *  `icon` also clears the legacy `shape`, so "Category default" really means
 *  the category icon and not a stale D154 shape. Returns null when the entry
 *  doesn't exist in the Grid library. Validation is the caller's job
 *  (setSymbolLookAction) — this is a plain patch. */
export async function setGridSymbolLook(
  id: string,
  look: { icon?: string | null; color?: string | null }
): Promise<GridSymbol | null> {
  return patchDoc<GridSymbol>("grid_catalog", id, (d) => {
    if ("icon" in look) {
      d.icon = look.icon ?? null;
      d.shape = null;
    }
    if ("color" in look) d.color = look.color ?? null;
    d.updatedAt = Date.now();
  });
}

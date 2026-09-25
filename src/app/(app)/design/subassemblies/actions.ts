"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { list as listCatalog } from "@/lib/stores/catalog";
import { FIXTURE_OPTION_CATEGORIES, resolveSubassembly } from "@/lib/fixture-assemblies";
import { create, remove, save, type FixtureOptionCategory, type FixtureSubassembly } from "@/lib/stores/subassemblies";
import { subassemblyPairs, subassemblyRef } from "@/lib/part-docs/assembly-graph";
import { syncAccessoryLinks } from "@/lib/stores/part-accessory-links";

type Input = { id?: string | null; label: string; description: string; lightEngineSku: string; lensSku: string; lamp: string; position: string; circuit: string; options: Record<FixtureOptionCategory, { sku: string; qty: number }[]> };

/**
 * Save a fixture subassembly. Prices come from resolveSubassembly over the
 * live catalog (#129) — the same numbers the screen shows — and are kept on
 * the record only as the build-time `snapshot` (plus the legacy cost fields
 * older readers expect); every later read re-resolves.
 */
export async function saveFixtureAction(input: Input): Promise<{ ok: true; item: FixtureSubassembly } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const label = input.label.trim();
  const description = input.description.trim();
  if (!label) return { ok: false, error: "Add a label for the fixture." };
  if (!input.lightEngineSku || !input.lensSku) return { ok: false, error: "Select a light engine and a lens from the catalog." };

  const options = { data: [], power: [], mounting: [], accessories: [] } as Record<FixtureOptionCategory, { sku: string; qty: number }[]>;
  for (const category of FIXTURE_OPTION_CATEGORIES) {
    for (const selected of input.options?.[category] || []) {
      const sku = String(selected.sku || "").trim();
      if (sku) options[category].push({ sku, qty: Math.max(1, Math.round(Number(selected.qty) || 1)) });
    }
  }

  const [catalog, settings] = await Promise.all([listCatalog(), getSettings()]);
  const live = resolveSubassembly({ lightEngineSku: input.lightEngineSku, lensSku: input.lensSku, options }, catalog, settings);
  if (!live.lightEngine.found || !live.lens.found) return { ok: false, error: "One of the selected catalog parts is no longer available." };
  if (live.missing.length) return { ok: false, error: `A selected catalog item is no longer available (${live.missing.join(", ")}).` };

  const now = Date.now();
  const item: FixtureSubassembly = {
    id: input.id || `SA-${now.toString(36).toUpperCase()}`,
    kind: "fixture",
    label,
    description,
    lightEngineSku: live.lightEngine.sku,
    lightEngineName: live.lightEngine.name,
    lightEngineCost: live.lightEngine.cost,
    lensSku: live.lens.sku,
    lensName: live.lens.name,
    lensCost: live.lens.cost,
    lamp: input.lamp.trim(),
    position: input.position.trim(),
    circuit: input.circuit.trim(),
    options: {
      data: live.options.data.map((o) => ({ sku: o.sku, name: o.name, cost: o.cost, qty: o.qty })),
      power: live.options.power.map((o) => ({ sku: o.sku, name: o.name, cost: o.cost, qty: o.qty })),
      mounting: live.options.mounting.map((o) => ({ sku: o.sku, name: o.name, cost: o.cost, qty: o.qty })),
      accessories: live.options.accessories.map((o) => ({ sku: o.sku, name: o.name, cost: o.cost, qty: o.qty })),
    },
    cost: live.cost,
    price: live.price,
    snapshot: { cost: live.cost, price: live.price, pricedAt: live.pricesAsOf },
    createdAt: now,
    updatedAt: now,
  };
  const saved = input.id ? await save(item) : await create(item);
  // Part documents (#DOC): the lens and options become the light engine's accessory links.
  await syncAccessoryLinks({ source: "assembly", sourceRef: subassemblyRef(saved.id) }, subassemblyPairs(saved));
  revalidatePath("/design/assemblies");
  revalidatePath("/design/subassemblies");
  return { ok: true, item: saved };
}

export async function deleteSubassemblyAction(id: string): Promise<void> {
  await requirePerm("manage_users");
  await remove(id);
  await syncAccessoryLinks({ source: "assembly", sourceRef: subassemblyRef(id) }, []);
  revalidatePath("/design/assemblies");
  revalidatePath("/design/subassemblies");
}

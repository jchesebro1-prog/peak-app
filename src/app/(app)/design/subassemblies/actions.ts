"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { get as getPart } from "@/lib/stores/catalog";
import { create, remove, save, type FixtureOptionCategory, type FixtureSubassembly } from "@/lib/stores/subassemblies";

type Input = { id?: string | null; label: string; description: string; lightEngineSku: string; lensSku: string; lamp: string; position: string; circuit: string; options: Record<FixtureOptionCategory, { sku: string; qty: number }[]> };

export async function saveFixtureAction(input: Input): Promise<{ ok: true; item: FixtureSubassembly } | { ok: false; error: string }> {
  await requireUser();
  const label = input.label.trim();
  const description = input.description.trim();
  if (!label) return { ok: false, error: "Add a label for the fixture." };
  if (!input.lightEngineSku || !input.lensSku) return { ok: false, error: "Select a light engine and a lens from the catalog." };
  const [engine, lens] = await Promise.all([getPart(input.lightEngineSku), getPart(input.lensSku)]);
  if (!engine || !lens) return { ok: false, error: "One of the selected catalog parts is no longer available." };
  const categories: FixtureOptionCategory[] = ["data", "power", "mounting", "accessories"];
  const options = { data: [], power: [], mounting: [], accessories: [] } as FixtureSubassembly["options"];
  for (const category of categories) {
    for (const selected of input.options?.[category] || []) {
      const part = await getPart(selected.sku);
      if (!part) return { ok: false, error: `A selected ${category} catalog item is no longer available.` };
      const qty = Math.max(1, Math.round(Number(selected.qty) || 1));
      options[category].push({ sku: part.sku, name: part.desc, cost: part.cost || 0, qty });
    }
  }
  const optionsCost = categories.reduce((sum, category) => sum + options[category].reduce((subtotal, option) => subtotal + option.cost * option.qty, 0), 0);
  const now = Date.now();
  const item: FixtureSubassembly = {
    id: input.id || `SA-${now.toString(36).toUpperCase()}`,
    kind: "fixture",
    label,
    description,
    lightEngineSku: engine.sku,
    lightEngineName: engine.desc,
    lightEngineCost: engine.cost || 0,
    lensSku: lens.sku,
    lensName: lens.desc,
    lensCost: lens.cost || 0,
    lamp: input.lamp.trim(),
    position: input.position.trim(),
    circuit: input.circuit.trim(),
    options,
    cost: (engine.cost || 0) + (lens.cost || 0) + optionsCost,
    price: (engine.cost || 0) + (lens.cost || 0) + optionsCost,
    createdAt: now,
    updatedAt: now,
  };
  const saved = input.id ? await save(item) : await create(item);
  revalidatePath("/design/subassemblies");
  return { ok: true, item: saved };
}

export async function deleteSubassemblyAction(id: string): Promise<void> {
  await requireUser();
  await remove(id);
  revalidatePath("/design/subassemblies");
}

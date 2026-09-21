import { getDoc, insertDocIfAbsent, listDocs, softDeleteDoc, upsertDoc } from "@/db/doc-store";

export type FixtureSubassembly = {
  id: string;
  kind: "fixture";
  label: string;
  description: string;
  lightEngineSku: string;
  lightEngineName: string;
  lightEngineCost: number;
  lensSku: string;
  lensName: string;
  lensCost: number;
  lamp?: string;
  position?: string;
  circuit?: string;
  options: Record<FixtureOptionCategory, FixtureCompatibleOption[]>;
  cost: number;
  price: number;
  createdAt: number;
  updatedAt: number;
};

export type FixtureOptionCategory = "data" | "power" | "mounting" | "accessories";
export type FixtureCompatibleOption = { sku: string; name: string; cost: number; qty: number };

export type Subassembly = FixtureSubassembly;

export async function list(): Promise<Subassembly[]> {
  return listDocs<Subassembly>("subassemblies");
}

export async function get(id: string): Promise<Subassembly | null> {
  return getDoc<Subassembly>("subassemblies", id);
}

export async function save(subassembly: Subassembly): Promise<Subassembly> {
  return upsertDoc("subassemblies", subassembly);
}

export async function create(subassembly: Omit<Subassembly, "id">): Promise<Subassembly> {
  const base = `SA-${Date.now().toString(36).toUpperCase()}`;
  const candidate = { ...subassembly, id: base };
  if (await insertDocIfAbsent("subassemblies", candidate)) return candidate;
  return save({ ...candidate, id: `${base}-${Math.floor(Math.random() * 1000)}` });
}

export async function remove(id: string): Promise<void> {
  await softDeleteDoc("subassemblies", id);
}

"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { listDocsByField } from "@/db/doc-store";
import type { CatalogPart } from "@/lib/stores/catalog";
import { fixtureSkus, resolveFixture, sanitizeFixtureInput, type FixtureInput } from "@/lib/fixture-assemblies";
import { createFixture, getFixture, removeFixture, updateFixture } from "@/lib/stores/fixtures";
import { fixturePairs, fixtureRef } from "@/lib/part-docs/assembly-graph";
import { setOwnDatasheet, syncAccessoryLinks } from "@/lib/stores/part-accessory-links";
import { searchCatalog } from "@/app/(app)/estimator/actions";
import type { PartHit } from "./fixture-form";

const revalidateConsumers = () => {
  // Grid checked (fix wave 1, I1/M4): no Grid route reads live fixtures
  // today. Grid's Scope panel wires the same ScopeInputsPanel fixture-picker
  // Quick Design uses, but scope-panel.tsx never passes it a fixtureAssemblies
  // list (the prop defaults to []), so the picker never renders there; and
  // grid-intake.tsx's AState.fixtureAssemblies id map is stored but never
  // read back against the live fixtures store within any Grid route. Add the
  // Grid route(s) here once that wiring lands (roadmap phase 10).
  for (const path of ["/design/assemblies", "/estimator", "/design/quick", "/catalog/documents"]) revalidatePath(path);
};

/**
 * The Assembly Builder's part pickers (#FXB fix wave 1, I1): a debounced
 * server search over the catalog instead of shipping all ~37,400 parts to
 * the client. Thin wrapper over the Estimator's `searchCatalog` (same
 * requireUser + result cap), reshaped to `PartHit` (adds `pricedAt`, drops
 * nothing `searchCatalog` already returns).
 */
export async function searchAssemblyPartsAction(query: string, limit = 40): Promise<{ hits: PartHit[]; total: number }> {
  const { hits, total } = await searchCatalog(query, "", limit);
  return {
    hits: hits.map((h) => ({
      sku: h.sku,
      desc: h.desc,
      category: h.category,
      mfr: h.mfr,
      unit: h.unit,
      list: h.list,
      cost: h.cost,
      ...(h.pricedAt ? { pricedAt: h.pricedAt } : {}),
    })),
    total,
  };
}

/**
 * Save a fixture or system (#FXB). Anyone signed in (spec §2.5); every save
 * stamps who/when. The snapshot ("was $X when built") prices from the live
 * catalog, read for THIS record's SKUs only — never the whole ~37k book. A
 * part missing from the catalog does not block the save. A fixture's lens
 * and box lines become its light engine's accessory links (scope
 * `fixture:<id>`); a system's scope is emptied.
 */
export async function saveFixtureAction(input: FixtureInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const clean = sanitizeFixtureInput(input);
  if (!clean.ok) return clean;
  const id = input?.id ? String(input.id) : null;
  const existing = id ? await getFixture(id) : null;
  if (id && !existing) return { ok: false, error: "This assembly was deleted — reload the page." };
  if (existing && existing.kind !== clean.value.kind) return { ok: false, error: "An assembly can't change between fixture and system." };
  const [parts, settings] = await Promise.all([
    listDocsByField<CatalogPart>("catalog_parts", "sku", fixtureSkus(clean.value)),
    getSettings(),
  ]);
  const live = resolveFixture({ ...clean.value, id: id || "new" }, parts, settings);
  const snapshot = { cost: live.cost, price: live.sell, pricedAt: live.pricesAsOf };
  const saved = existing
    ? await updateFixture(existing, clean.value, user.name, snapshot)
    : await createFixture(clean.value, user.name, snapshot);
  await syncAccessoryLinks({ source: "assembly", sourceRef: fixtureRef(saved.id) }, fixturePairs(saved));
  revalidateConsumers();
  return { ok: true, id: saved.id };
}

export async function deleteFixtureAction(id: string): Promise<{ ok: true }> {
  await requireUser();
  await removeFixture(String(id || ""));
  await syncAccessoryLinks({ source: "assembly", sourceRef: fixtureRef(String(id || "")) }, []);
  revalidateConsumers();
  return { ok: true };
}

/** A line's "has its own datasheet" toggle (#207, spec §3/§4): the pair
 *  stops (or resumes) counting the fixture's datasheet as the part's. */
export async function setOwnDatasheetAction(parentSku: string, accessorySku: string, own: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  const { linked } = await setOwnDatasheet(String(parentSku || ""), String(accessorySku || ""), !!own);
  // Only a pair missing from the graph is an error; setting the flag to the
  // value it already has is a no-op success (final fix wave, M1).
  if (!linked) return { ok: false, error: "Save the assembly first — this part isn't linked to the fixture yet." };
  revalidatePath("/design/assemblies");
  revalidatePath("/catalog/documents");
  return { ok: true };
}

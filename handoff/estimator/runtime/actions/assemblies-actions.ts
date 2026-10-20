/**
 * Estimator handoff — browser implementations of src/app/(app)/design/assemblies/actions.ts (the Assembly Builder),
 * over the HandoffStore. Each mirrors its original's validation, writes and result shape — enforced by `Impl<A, K>`,
 * the original's own signature:
 *
 *   searchAssemblyPartsAction  the Estimator's searchCatalog (same ranking, same cap — clampPickerLimit) reshaped to PartHit
 *   saveFixtureAction          sanitizeFixtureInput → the deleted / kind-change refusals → the "was $X when built" snapshot
 *                              priced by resolveFixture from THIS record's SKUs (renames followed) and the settings'
 *                              priceListEffective → createFixture / updateFixture (fixtures-repo.ts). The accessory links
 *                              syncAccessoryLinks would write are derived from the saved fixtures when the page reads
 *                              (props/assemblies.ts), so none are stored here.
 *   deleteFixtureAction        soft delete (fixtures-repo.ts removeFixtureLocal)
 *   saveRackDefaultsAction     Create permission, then the `rack_defaults` blob's `defaults` (full replacement)
 *   setOwnDatasheetAction      REFUSED — part documents and the accessory-link graph's flags are not in the prototype
 *
 * revalidatePath / the portal index drop → the router's refresh() (the builder and the Estimator re-read their props).
 * Plan: PR 2 Task 9.
 */
import type * as Original from "@/app/(app)/design/assemblies/actions";
import { clampPickerLimit, fixtureSkus, resolveFixture, sanitizeFixtureInput } from "@/lib/fixture-assemblies";
import { RACK_DEFAULTS_BLOB, sanitizeRackDefaults } from "@/lib/rack/defaults";
import { can } from "@/lib/team";
import { refresh } from "../router";
import type { HandoffStore } from "../store";
import { refreshPortsFromStore, settingsView, users } from "../ports";
import { getManyLocal } from "../readers";
import { createFixtureLocal, getFixtureLocal, removeFixtureLocal, updateFixtureLocal } from "../fixtures-repo";
import { estimatorActions } from "./estimator-actions";
import { refusals } from "./misc-refusals";
import type { Impl as ImplOf } from "./util";

export const ASSEMBLIES_ACTIONS_KEY = "src/app/(app)/design/assemblies/actions.ts";

type A = typeof Original;
type Impl<K extends keyof A> = ImplOf<A, K>;

export type ImplementedAssembliesAction = "searchAssemblyPartsAction" | "saveFixtureAction" | "deleteFixtureAction" | "saveRackDefaultsAction";
export const REFUSED_ASSEMBLIES_ACTIONS = ["setOwnDatasheetAction"] as const;

/** The explicit refusals (NOT_IN_PROTOTYPE + one console.warn), type-checked as refusable. */
export function refusedAssembliesActions() {
  return refusals<A>(REFUSED_ASSEMBLIES_ACTIONS);
}

export function assembliesActions(store: HandoffStore): { [K in ImplementedAssembliesAction]: Impl<K> } {
  const { searchCatalog } = estimatorActions(store);

  const searchAssemblyPartsAction: Impl<"searchAssemblyPartsAction"> = async (query, limit = 40) => {
    // The limit arrives from the client: clamp it (final review M2).
    const { hits, total } = await searchCatalog(String(query ?? ""), "", clampPickerLimit(limit));
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
        ...(h.priceDate ? { priceDate: h.priceDate } : {}),
        rack: h.rack,
      })),
      total,
    };
  };

  const saveFixtureAction: Impl<"saveFixtureAction"> = async (input) => {
    await refreshPortsFromStore(store);
    const user = users.current();
    const clean = sanitizeFixtureInput(input);
    if (!clean.ok) return clean;
    const id = input?.id ? String(input.id) : null;
    const existing = id ? await getFixtureLocal(store, id) : null;
    if (id && !existing) return { ok: false, error: "This assembly was deleted — reload the page." };
    if (existing && existing.kind !== clean.value.kind) return { ok: false, error: "An assembly can't change kind after it's created." };
    const parts = await getManyLocal(store, fixtureSkus(clean.value));
    const live = resolveFixture({ ...clean.value, id: id || "new" }, parts, settingsView() as { priceListEffective?: Record<string, number> });
    const snapshot = { cost: live.cost, price: live.sell, pricedAt: live.pricesAsOf };
    let saved;
    try {
      saved = existing ? await updateFixtureLocal(store, existing, clean.value, user.name, snapshot) : await createFixtureLocal(store, clean.value, user.name, snapshot);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Could not save this assembly." };
    }
    refresh();
    return { ok: true, id: saved.id };
  };

  const deleteFixtureAction: Impl<"deleteFixtureAction"> = async (id) => {
    await refreshPortsFromStore(store);
    await removeFixtureLocal(store, String(id || ""));
    refresh();
    return { ok: true };
  };

  const saveRackDefaultsAction: Impl<"saveRackDefaultsAction"> = async (input) => {
    const user = users.current();
    if (!can("create", user.roles)) return { ok: false, error: "Needs the Create permission." };
    const value = sanitizeRackDefaults(input);
    // setBlob merges top-level keys: the value lives under `defaults`, so a cleared SKU really clears.
    const prior = await store.get<{ id: string; data?: Record<string, unknown> }>("blobs", RACK_DEFAULTS_BLOB);
    await store.put("blobs", { id: RACK_DEFAULTS_BLOB, data: { ...(prior?.data ?? {}), defaults: value } });
    await refreshPortsFromStore(store);
    refresh();
    return { ok: true, value };
  };

  return { searchAssemblyPartsAction, saveFixtureAction, deleteFixtureAction, saveRackDefaultsAction };
}

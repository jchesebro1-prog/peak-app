import Link from "next/link";
import { requireUser } from "@/lib/session";
import { all as allCustomers } from "@/lib/stores/customers";
import { byCategory } from "@/lib/stores/catalog";
import { listDesigns, getDesign } from "@/lib/stores/studio-designs";
import { DEFAULT_LINESET_INPUTS, type LinesetInputs } from "@/lib/design/lineset";
import type { LinesetMode, WeightDefaults, WeightLine } from "@/lib/design/steel";
import { DEFAULT_GEAR, type GoodsTier, type GearDefaults } from "@/lib/design/goods";
import {
  LinesetBuilder,
  type CombinedInitial,
  type CombinedLinesetData,
} from "./lineset-builder";

export const metadata = { title: "Lineset Builder — Quartzite-6" };

/**
 * Normalize a stored input block of ANY vintage into today's LinesetInputs.
 *
 * Two jobs, both key-by-key rather than by spread:
 * - BACKFILL. v2 records predate the PRO dimensions, so an absent proWidthFt /
 *   proHeightFt takes the default and the design opens with working goods
 *   geometry rather than zero-size drapes.
 * - DROP RETIRED KEYS. `stageWidthFt` / `stageWidthIn` left the model in punch
 *   #50. A plain spread would carry them back out through the next save; worse,
 *   a stored 0 would have survived into a field with no UI left to fix it.
 *   Ignoring them on load (never erroring) is the compatibility rule here.
 */
function normalizeInputs(inp: Partial<LinesetInputs> | undefined): LinesetInputs {
  const src = (inp || {}) as Record<string, unknown>;
  const out: LinesetInputs = { ...DEFAULT_LINESET_INPUTS };
  (Object.keys(DEFAULT_LINESET_INPUTS) as (keyof LinesetInputs)[]).forEach((k) => {
    const v = src[k];
    if (v !== undefined && v !== null && typeof v === typeof DEFAULT_LINESET_INPUTS[k]) {
      (out as Record<string, unknown>)[k] = v;
    }
  });
  return out;
}

/** The on-disk shape of a combined save at either vintage. v2 predates
 *  proWidthFt/proHeightFt (inside `inputs`) and the `tier`/`gear` fields
 *  entirely — all optional here and backfilled by resolveInitial(). */
type StoredCombinedLineset = Omit<CombinedLinesetData, "v" | "inputs" | "tier" | "gear" | "categoryModes"> & {
  v: 2 | 3 | 4;
  inputs: Partial<LinesetInputs>;
  tier?: GoodsTier;
  gear?: GearDefaults;
  categoryModes?: Partial<Record<string, LinesetMode>>;
};

/**
 * Adapt a saved design of ANY vintage into the merged tool's initial state
 * (D78 / P3 migration-on-load — no DB rewrite):
 * - v2 or v3 combined: passed through, backfilling PRO dims / tier / gear
 *   when the record predates them.
 * - legacy Builder save (bare LinesetInputs): inputs only, no weights yet.
 * - legacy Weights save ({defaults, lines}): its hand-keyed rows become
 *   CUSTOM lines (they never had generated identities), defaults carry over,
 *   and saving creates a NEW combined design — the old record stays.
 */
function resolveInitial(
  design: { kind: string; data: unknown } | null
): { initial: CombinedInitial | undefined; adoptable: boolean } {
  if (!design) return { initial: undefined, adoptable: false };
  const d = design.data as Record<string, unknown>;
  const ver = (d as { v?: number }).v;
  if (design.kind === "lineset" && d && (ver === 2 || ver === 3 || ver === 4)) {
    const rec = design.data as StoredCombinedLineset;
    return {
      initial: {
        inputs: normalizeInputs(rec.inputs),
        defaults: rec.defaults,
        loads: rec.loads || {},
        extras: rec.extras || [],
        tier: rec.tier || "better",
        gear: rec.gear || DEFAULT_GEAR,
        categoryModes: rec.categoryModes || {},
      },
      adoptable: true,
    };
  }
  // Legacy bare-LinesetInputs record. Detected on stageDepthFt, which every
  // vintage has: stageWidthFt (the old marker) was retired in punch #50.
  if (design.kind === "lineset" && d && "stageDepthFt" in d) {
    return {
      initial: {
        inputs: normalizeInputs(design.data as Partial<LinesetInputs>),
        tier: "better",
        gear: DEFAULT_GEAR,
      },
      adoptable: true,
    };
  }
  if (design.kind === "weights" && d && Array.isArray((d as { lines?: unknown }).lines)) {
    const w = design.data as { defaults: WeightDefaults; lines: WeightLine[] };
    return {
      initial: {
        defaults: w.defaults,
        extras: (w.lines || []).map((l, i) => ({ ...l, xid: "legacy" + i })),
        legacyWeights: true,
        tier: "better",
        gear: DEFAULT_GEAR,
      },
      adoptable: false, // saving must create a new combined design
    };
  }
  return { initial: undefined, adoptable: false };
}

export default async function LinesetBuilderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, custs, savedLineset, savedWeights, fabricParts] = await Promise.all([
    requireUser(),
    searchParams,
    allCustomers(),
    listDesigns({ kind: "lineset" }),
    listDesigns({ kind: "weights" }), // legacy records stay openable here
    byCategory("Fabric"),
  ]);
  const customers = custs.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  const designId = Array.isArray(sp.design) ? sp.design[0] : sp.design;
  const design = designId ? await getDesign(designId) : null;
  const { initial, adoptable } = resolveInitial(design);
  const loaded =
    design && adoptable
      ? { id: design.id, name: design.name, customerId: design.customerId }
      : null;
  const saved = [
    ...savedLineset.map((d) => ({ id: d.id, name: d.name, customer: d.customer })),
    ...savedWeights.map((d) => ({ id: d.id, name: d.name + " (legacy weights)", customer: d.customer })),
  ];

  return (
    <div className="pk-content" style={{ maxWidth: 1600 }}>
      <div style={{ marginBottom: 14 }}>
        <Link href="/design" style={{ fontSize: 12.5, fontWeight: 600, color: "#8c919c", textDecoration: "none" }}>
          ← Design
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>Lineset Builder</h1>
        <p style={{ color: "#6b7079", fontSize: 13.5, marginTop: 3 }}>
          Auto-place a lineset schedule on the 8-inch grid, then enter each line&apos;s goods —
          weight, hoist checks, counterweight and beam loads calculate live on the same screen.
        </p>
      </div>
      <LinesetBuilder initial={initial} customers={customers} saved={saved} loaded={loaded} fabrics={fabricParts} />
    </div>
  );
}

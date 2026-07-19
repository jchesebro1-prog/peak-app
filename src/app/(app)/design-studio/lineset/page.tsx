import Link from "next/link";
import { requireUser } from "@/lib/session";
import { all as allCustomers } from "@/lib/stores/customers";
import { listDesigns, getDesign } from "@/lib/stores/studio-designs";
import type { LinesetInputs } from "@/lib/design/lineset";
import type { WeightDefaults, WeightLine } from "@/lib/design/steel";
import {
  LinesetBuilder,
  type CombinedInitial,
  type CombinedLinesetData,
} from "./lineset-builder";

export const metadata = { title: "Lineset Builder — Peak Backend" };

/**
 * Adapt a saved design of ANY vintage into the merged tool's initial state
 * (D78 / P3 migration-on-load — no DB rewrite):
 * - v2 combined: passed through.
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
  if (design.kind === "lineset" && d && (d as { v?: number }).v === 2) {
    const v2 = design.data as CombinedLinesetData;
    return {
      initial: {
        inputs: v2.inputs,
        defaults: v2.defaults,
        loads: v2.loads || {},
        extras: v2.extras || [],
      },
      adoptable: true,
    };
  }
  if (design.kind === "lineset" && d && "stageWidthFt" in d) {
    return { initial: { inputs: design.data as LinesetInputs }, adoptable: true };
  }
  if (design.kind === "weights" && d && Array.isArray((d as { lines?: unknown }).lines)) {
    const w = design.data as { defaults: WeightDefaults; lines: WeightLine[] };
    return {
      initial: {
        defaults: w.defaults,
        extras: (w.lines || []).map((l, i) => ({ ...l, xid: "legacy" + i })),
        legacyWeights: true,
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
  const [, sp, custs, savedLineset, savedWeights] = await Promise.all([
    requireUser(),
    searchParams,
    allCustomers(),
    listDesigns({ kind: "lineset" }),
    listDesigns({ kind: "weights" }), // legacy records stay openable here
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
    <div className="pk-content" style={{ maxWidth: 1120 }}>
      <div style={{ marginBottom: 14 }}>
        <Link href="/design-studio" style={{ fontSize: 12.5, fontWeight: 600, color: "#8c919c", textDecoration: "none" }}>
          ← Design Studio
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>Lineset Builder</h1>
        <p style={{ color: "#6b7079", fontSize: 13.5, marginTop: 3 }}>
          Auto-place a lineset schedule on the 8-inch grid, then enter each line&apos;s goods —
          weight, hoist checks, counterweight and beam loads calculate live on the same screen.
        </p>
      </div>
      <LinesetBuilder initial={initial} customers={customers} saved={saved} loaded={loaded} />
    </div>
  );
}

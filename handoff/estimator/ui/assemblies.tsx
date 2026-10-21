/**
 * Estimator handoff — `#/assemblies` and `#/assemblies/rack/<id>`: the app's real Assembly Builder (FixtureBuilder —
 * fixtures, systems, hardware and racks with the RU sidebar) and a rack's real submittal sheets (RackSheets), each
 * under the markup its server page renders (src/app/(app)/design/assemblies/page.tsx, …/rack/[id]/page.tsx). Props
 * come from the store (runtime/props/assemblies.ts, runtime/loaders/rack.ts); the builder's server actions are the
 * browser ones in runtime/actions/assemblies-actions.ts. `router.refresh()` (after a save or delete) re-reads the props,
 * as a server re-render would — the builder keeps its client state across it. Plan: PR 2 Task 9.
 */
import { useCallback, type CSSProperties } from "react";
import { NOT_IN_PROTOTYPE_COPY } from "../runtime/routes";
import FixtureBuilder from "@/app/(app)/design/assemblies/fixture-builder";
import { PrintButton } from "@/components/letter/print-button";
import { RackSheets } from "@/components/rack/RackSheets";
import { RACK_PREVIEW_CSS } from "@/components/rack/rack-sheet-css";
import type { LoadedRackSheets } from "@/lib/rack/load";
import { settingsView } from "../runtime/ports";
import { buildAssemblyBuilderProps, type AssemblyBuilderProps } from "../runtime/props/assemblies";
import { loadRackForSheetsLocal } from "../runtime/loaders/rack";
import type { HandoffStore } from "../runtime/store";
import { LoadError } from "./load-error";
import { useRefreshedProps } from "./use-refreshed-props";

const FILL: CSSProperties = { position: "absolute", inset: 0, overflow: "auto" };

/** AssemblyBuilderPage, in the browser. */
export function AssembliesScreen({ store, onReady }: { store: HandoffStore; onReady: () => void }) {
  const load = useCallback(() => buildAssemblyBuilderProps(store), [store]);
  const loaded = useRefreshedProps<AssemblyBuilderProps>(load, onReady, "assemblies");
  if (!loaded) return <div style={FILL} data-handoff-loading="" />;
  if ("error" in loaded) return <LoadError message={loaded.error} onReady={onReady} />;
  const props = loaded.value;
  return (
    <div style={FILL} data-handoff-assemblies="">
      <div className="pk-content" style={{ maxWidth: 1080 }}>
        {/* The app's "← Design" link is left out: the Design hub is not in the prototype. */}
        <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: "7px 0 4px" }}>Assembly Builder</h1>
        <p style={{ color: "#8c919c", fontSize: 13, margin: "0 0 16px", maxWidth: 700 }}>
          Fixtures, systems, hardware and racks in one list. Everything prices from the live catalog — a price-list import re-prices them at once.
        </p>
        <FixtureBuilder
          initial={props.initial}
          parts={props.parts}
          priceListEffective={props.priceListEffective}
          coverage={props.coverage}
          portalCategories={props.portalCategories}
          rackDefaults={props.rackDefaults}
        />
      </div>
    </div>
  );
}

const LINK = { fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none" } as const;

/** RackSubmittalPage, in the browser: the elevation, schedule and power/heat sheets of one saved rack. */
export function RackScreen({ store, id, onReady }: { store: HandoffStore; id: string; onReady: () => void }) {
  const load = useCallback(async () => ({ data: await loadRackForSheetsLocal(store, id) }), [store, id]);
  const loaded = useRefreshedProps<{ data: LoadedRackSheets | null }>(load, onReady, "rack sheets");
  if (!loaded) return <div style={FILL} data-handoff-loading="" />;
  if ("error" in loaded) return <LoadError message={loaded.error} onReady={onReady} />;
  const { data } = loaded.value;
  if (!data) {
    // The page's notFound().
    return (
      <div style={{ ...FILL, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "56px 24px" }} data-handoff-missing="">
        <div style={{ maxWidth: 520, textAlign: "center" }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Rack not found</div>
          <div style={{ fontSize: 14, color: "#8c919c", marginTop: 8 }}>
            There is no saved rack <code>{id}</code> in this browser&apos;s data.
          </div>
          <a href="#/assemblies" className="pk-btn-outline" style={{ display: "inline-block", marginTop: 16, textDecoration: "none" }}>
            ← Back to assemblies
          </a>
        </div>
      </div>
    );
  }
  const accent = (settingsView().accent as string) || "#b08d4a";
  return (
    <div style={FILL} data-handoff-rack={data.rec.id}>
      <div className="pk-content" style={{ maxWidth: "none", padding: "22px 24px 64px" }}>
        <style>{RACK_PREVIEW_CSS}</style>
        <div className="pk-doc-toolbar pk-no-print" style={{ maxWidth: "none", justifyContent: "flex-start", flexWrap: "wrap", gap: 14 }}>
          <a href="#/assemblies" style={LINK}>← Back to assemblies</a>
          <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-ui)" }}>{`Rack submittal — ${data.rec.label}`}</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 14, alignItems: "center" }}>
            {/* The app's "Download submittal (.zip)" and "Schedule (.csv)" are server routes (the zip merges datasheet PDFs):
                not in the prototype. Said inline, with no dead link; the sheets print with the browser. */}
            <span data-handoff-rack-downloads="" style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "#8c919c" }}>
              Submittal .zip and schedule .csv: {NOT_IN_PROTOTYPE_COPY.toLowerCase()} — print the sheets instead
            </span>
            <PrintButton accent={accent} />
          </span>
        </div>
        <RackSheets sheet="all" data={data} />
      </div>
    </div>
  );
}

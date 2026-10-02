/**
 * #296 — the rack folders of a client package, pure: from each rack's run
 * (Task 12's files, or why it has none) to the zip entries under
 * `racks/<folder>/`, the index rows and the customer-facing gaps. The zip's
 * index is customer-facing, so a gap says only RACK_ON_REQUEST; the staff
 * detail (which sheet failed, late, deleted) comes back as `warnings` for
 * the server log. No stores, no Chrome.
 */
import type { ClientPackageGap } from "@/lib/client-package";
import type { ZipFile } from "@/lib/zip";
import type { RackSubmittalGap } from "./submittal";

/** The one sentence the customer's index gives for a rack whose drawings aren't all in the zip. */
export const RACK_ON_REQUEST = "Rack drawings available on request.";
/** What a complete rack folder holds (no datasheets.pdf — the package's own datasheets/ covers the members). */
export const RACK_PACKAGE_FILES = ["elevation.pdf", "schedule.pdf", "power-heat.pdf", "schedule.csv"] as const;

export type RackRun =
  /** rackSubmittalFiles ran: `folder` is its safeName'd label, `staffGaps` its gaps. */
  | { id: string; name: string; outcome: "done"; folder: string; files: ZipFile[]; staffGaps: RackSubmittalGap[] }
  /** Sheets not started — too little time left in the package budget; still carries what needs no Chrome (schedule.csv). */
  | { id: string; name: string; outcome: "late"; folder: string; files: ZipFile[] }
  /** The rack id resolves to nothing (deleted, or no longer a rack). */
  | { id: string; name: string; outcome: "missing" };

export type RackIndexEntry = { name: string; folder: string; files: string[] };

export type RackPackageEntries = {
  files: ZipFile[];
  index: RackIndexEntry[];
  gaps: ClientPackageGap[];
  /** Staff-only lines for console.warn — never the zip. */
  warnings: string[];
  /** Rack id → its final folder (after clash suffixes). */
  folderOf: Map<string, string>;
};

export function rackPackageEntries(runs: readonly RackRun[]): RackPackageEntries {
  const files: ZipFile[] = [];
  const index: RackIndexEntry[] = [];
  const gaps: ClientPackageGap[] = [];
  const warnings: string[] = [];
  const folderOf = new Map<string, string>();
  const used = new Set<string>();
  const gap = (name: string) => gaps.push({ kind: "missing-rack", sku: "RACK", description: `${name} — ${RACK_ON_REQUEST}`, qty: 1, catalogId: null });

  for (const run of runs) {
    if (run.outcome === "missing") {
      warnings.push(`rack ${run.id} (${run.name}): not found — deleted or no longer a rack`);
      gap(run.name);
      continue;
    }
    if (run.outcome === "late") warnings.push(`rack ${run.id} (${run.name}): sheets not started — too little time left in the package budget`);
    // Two racks with the same label would share a folder: suffix -2, -3… (case-insensitive, for Windows/macOS unzip).
    let folder = run.folder;
    for (let n = 2; used.has(folder.toLowerCase()); n++) folder = `${run.folder}-${n}`;
    used.add(folder.toLowerCase());
    folderOf.set(run.id, folder);
    for (const g of run.outcome === "done" ? run.staffGaps : []) warnings.push(`rack ${run.id} (${run.name}): ${g.label || g.sku}: ${g.detail}`);
    const names = run.files.map((f) => f.name);
    if (names.length) {
      for (const f of run.files) files.push({ name: `racks/${folder}/${f.name}`, data: f.data });
      index.push({ name: run.name, folder, files: names });
    }
    const missing = RACK_PACKAGE_FILES.filter((n) => !names.includes(n));
    if (missing.length) {
      warnings.push(`rack ${run.id} (${run.name}): left out of the package — ${missing.join(", ")}`);
      gap(run.name);
    }
  }
  return { files, index, gaps, warnings, folderOf };
}

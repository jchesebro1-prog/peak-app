/**
 * #296 — optional rack data on a catalog part: parsing, form reading and the
 * coverage helper. Pure (no store/db imports) — client components import it.
 * Absent = unknown, never zero; 0 means "measured, none".
 */
import { isInternalCategory } from "@/lib/portal-visibility";
import {
  AIRFLOWS,
  MOUNT_FACES,
  RACK_FACT_KEYS,
  RACK_MOUNTS,
  RACK_WIDTHS,
  type RackDataField,
  type RackFactKey,
  type RackPartFacts,
  type RackPartInfo,
  type RackPartLookup,
} from "./types";

export const RACK_FACT_LABEL: Record<RackFactKey, string> = {
  rackMount: "Rack mount",
  ruHeight: "RU height",
  rackWidth: "Rack width",
  depthIn: "Depth (in)",
  weightLb: "Weight (lb)",
  powerWatts: "Power (W)",
  maxPowerWatts: "Max power (W)",
  powerCapacityWatts: "Outlet capacity (W)",
  mountFace: "Mount face",
  airflow: "Airflow",
  rackNotes: "Rack notes",
};

export const RACK_NOTES_MAX = 200;

/** Short label used in error text, e.g. "RU height", "airflow". */
const ERR_LABEL: Record<RackFactKey, string> = {
  rackMount: "rack mount",
  ruHeight: "RU height",
  rackWidth: "rack width",
  depthIn: "depth",
  weightLb: "weight",
  powerWatts: "power",
  maxPowerWatts: "max power",
  powerCapacityWatts: "outlet capacity",
  mountFace: "mount face",
  airflow: "airflow",
  rackNotes: "notes",
};

const ENUMS: Partial<Record<RackFactKey, readonly string[]>> = {
  rackMount: RACK_MOUNTS,
  rackWidth: RACK_WIDTHS,
  mountFace: MOUNT_FACES,
  airflow: AIRFLOWS,
};

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

function numberOf(k: RackFactKey, v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  if (k === "ruHeight" && !(n > 0 && Number.isInteger(n * 2))) return null;
  return n;
}

/**
 * Validate the rack keys PRESENT in `input` (keys absent never appear in the
 * patch, so mergeUpsert keeps the stored value; a blank → undefined clears).
 */
export function cleanRackFacts(
  input: Record<string, unknown>
): { ok: true; patch: Partial<RackPartFacts> } | { ok: false; error: string } {
  const patch: Record<string, unknown> = {};
  for (const k of RACK_FACT_KEYS) {
    if (!(k in input)) continue;
    const v = input[k];
    if (isBlank(v)) {
      patch[k] = undefined;
      continue;
    }
    const enums = ENUMS[k];
    if (enums) {
      const s = String(v).trim();
      if (!enums.includes(s)) return { ok: false, error: `Rack data: ${ERR_LABEL[k]} must be one of ${enums.join(", ")}.` };
      patch[k] = s;
    } else if (k === "rackNotes") {
      patch[k] = String(v).trim().slice(0, RACK_NOTES_MAX) || undefined;
    } else {
      const n = numberOf(k, v);
      if (n === null)
        return {
          ok: false,
          error:
            k === "ruHeight"
              ? "Rack data: RU height must be a positive number in half-RU steps."
              : `Rack data: ${ERR_LABEL[k]} must be a number, zero or more.`,
        };
      patch[k] = n;
    }
  }
  return { ok: true, patch: patch as Partial<RackPartFacts> };
}

/** The rack_<key> fields a form carries — only names present. */
export function rackFactsFromForm(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of RACK_FACT_KEYS) {
    const name = `rack_${k}`;
    if (fd.has(name)) out[k] = fd.get(name);
  }
  return out;
}

/** Pick the rack keys off a stored part, dropping anything invalid. */
export function rackFactsOf(part: Partial<RackPartFacts> | null | undefined): RackPartFacts {
  const out: Record<string, unknown> = {};
  if (!part) return out as RackPartFacts;
  const src = part as Record<string, unknown>;
  for (const k of RACK_FACT_KEYS) {
    const v = src[k];
    if (isBlank(v)) continue;
    const enums = ENUMS[k];
    if (enums) {
      if (typeof v === "string" && enums.includes(v)) out[k] = v;
    } else if (k === "rackNotes") {
      if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, RACK_NOTES_MAX);
    } else if (typeof v === "number") {
      const n = numberOf(k, v);
      if (n !== null) out[k] = n;
    }
  }
  return out as RackPartFacts;
}

/** rackFactsOf, or undefined when the part carries no rack data (search hits omit it). */
export function rackFactsOrUndefined(part: Partial<RackPartFacts> | null | undefined): RackPartFacts | undefined {
  const f = rackFactsOf(part);
  return Object.keys(f).length ? f : undefined;
}

/**
 * A part as the rack engine sees it; an unknown SKU resolves `found: false`.
 * Pass the catalog `category` so an internal row (Labor — see
 * `isInternalCategory`) comes back `internal: true`.
 */
export function rackPartInfo(
  part: ({ sku: string; desc: string; mfr?: string; category?: string | null } & Partial<RackPartFacts>) | undefined,
  sku: string
): RackPartInfo {
  if (!part) return { sku, desc: "", found: false };
  return {
    ...rackFactsOf(part),
    sku: part.sku || sku,
    desc: part.desc,
    ...(part.mfr ? { mfr: part.mfr } : {}),
    found: true,
    ...(isInternalCategory(part.category) ? { internal: true } : {}),
  };
}

const COVERAGE_FIELDS: readonly RackDataField[] = ["ruHeight", "depthIn", "weightLb", "powerWatts"];

/** Distinct SKUs and which of them lack each rack field. An unknown SKU lacks all four; an internal (labor) row isn't counted. */
export function rackDataCoverage(
  skus: readonly string[],
  lookup: RackPartLookup
): { total: number; missing: Record<RackDataField, string[]> } {
  const distinct = [...new Set(skus)].filter((sku) => !lookup(sku)?.internal);
  const missing: Record<RackDataField, string[]> = { ruHeight: [], depthIn: [], weightLb: [], powerWatts: [] };
  for (const sku of distinct) {
    const info = lookup(sku);
    for (const f of COVERAGE_FIELDS) if (!info || info[f] === undefined) missing[f].push(sku);
  }
  return { total: distinct.length, missing };
}

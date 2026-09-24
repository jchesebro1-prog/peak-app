import type { DavinciRecord } from "./extract";

export function normalizeSku(s: string): string {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function buildIndex(records: DavinciRecord[]): Map<string, DavinciRecord> {
  const out = new Map<string, DavinciRecord>();
  for (const record of records) for (const model of record.modelNumbers) {
    const key = normalizeSku(model);
    if (key && !out.has(key)) out.set(key, record);
  }
  return out;
}

export function matchPart(part: { sku: string }, index: Map<string, DavinciRecord>): DavinciRecord | null {
  return index.get(normalizeSku(part.sku)) || null;
}

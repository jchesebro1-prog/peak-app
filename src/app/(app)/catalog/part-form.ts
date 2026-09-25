/**
 * Pure halves of catalog/actions.ts, so the harness can test them.
 */

function num(v: FormDataEntryValue | null): number {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

/**
 * Fields the part modal may or may not render. A key the form did NOT submit
 * stays out of the patch, so mergeUpsert keeps the stored value; a submitted
 * blank clears it (an explicit undefined wins in mergeUpsert). Same rule
 * upsertPart already applies to `ports`.
 */
export function optionalPartFields(fd: FormData): {
  manufacturerPartNumber?: string;
  manufacturerModelNumber?: string;
  mapPrice?: number;
} {
  const text = (k: string) => String(fd.get(k) || "").trim() || undefined;
  const out: { manufacturerPartNumber?: string; manufacturerModelNumber?: string; mapPrice?: number } = {};
  if (fd.has("manufacturerPartNumber")) out.manufacturerPartNumber = text("manufacturerPartNumber");
  if (fd.has("manufacturerModelNumber")) out.manufacturerModelNumber = text("manufacturerModelNumber");
  if (fd.has("mapPrice")) out.mapPrice = num(fd.get("mapPrice"));
  return out;
}

/** The same-as rules the Spec panel's save enforces. null = fine. */
export function validateSameAs(
  sku: string,
  sameAs: string,
  target: { sku: string; specSameAs?: string } | null
): string | null {
  const want = String(sameAs || "").trim();
  if (!want) return null;
  if (want.toUpperCase() === String(sku || "").trim().toUpperCase()) return "A part cannot be the same spec as itself.";
  if (!target) return `Same spec as ${want} — no such part.`;
  if ((target.specSameAs || "").trim()) {
    return `${want} is itself a "same spec as" pointer — point at the part that holds the text.`;
  }
  return null;
}

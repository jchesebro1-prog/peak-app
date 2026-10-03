import { mfrKey } from "@/lib/catalog-books";

/** Catalog → Manufacturers rows (pure). One row per mfrKey; Labor and blank
 *  manufacturers left out; the shown name is the most common spelling. */
export type ManufacturerRow = { key: string; name: string; spellings: string[]; parts: number; withoutPhoto: number; imageDocumentId: string | null };

export function manufacturerRows(
  parts: readonly { mfr?: string; category?: string; sku: string }[],
  hasOwnPhoto: (sku: string) => boolean,
  records: readonly { key: string; imageDocumentId: string | null }[]
): ManufacturerRow[] {
  const acc = new Map<string, { counts: Map<string, number>; parts: number; withoutPhoto: number }>();
  for (const p of parts) {
    if (p.category === "Labor") continue;
    const name = String(p.mfr ?? "").trim();
    const key = mfrKey(name);
    if (!key) continue;
    let a = acc.get(key);
    if (!a) acc.set(key, (a = { counts: new Map(), parts: 0, withoutPhoto: 0 }));
    a.counts.set(name, (a.counts.get(name) ?? 0) + 1);
    a.parts++;
    if (!hasOwnPhoto(p.sku)) a.withoutPhoto++;
  }
  const image = new Map(records.map((r) => [r.key, r.imageDocumentId] as const));
  const rows: ManufacturerRow[] = [];
  for (const [key, a] of acc) {
    const names = [...a.counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    rows.push({ key, name: names[0][0], spellings: names.slice(1).map((n) => n[0]).sort((x, y) => x.localeCompare(y)), parts: a.parts, withoutPhoto: a.withoutPhoto, imageDocumentId: image.get(key) ?? null });
  }
  return rows.sort((x, y) => y.parts - x.parts || x.name.localeCompare(y.name));
}

/** Upload many: a file name (extension dropped) matches the row whose key it equals — never a substring. */
export function matchManufacturerFile(fileName: string, rows: readonly Pick<ManufacturerRow, "key">[]): string | null {
  const base = String(fileName ?? "").split(/[\\/]/).pop() || "";
  const key = mfrKey(base.replace(/\.[A-Za-z0-9]{1,5}$/, ""));
  return key && rows.some((r) => r.key === key) ? key : null;
}

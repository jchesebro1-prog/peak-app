import { mfrKey } from "@/lib/catalog-books";
import { canonicalKeyMap, groupKeys } from "@/lib/manufacturer-aliases";

/**
 * The manufacturer page's view model (Manufacturer section Part 2). Pure:
 * the page loads everything and hands it here; client-safe (types only
 * reach the client component). Analytics is added by Part 3, not here.
 */

export type MfrPageRecord = {
  key: string;
  name?: string;
  imageDocumentId: string | null;
  aliasKeys: string[];
  mergedInto: string | null;
  notes?: string;
};
export type MfrPagePart = { sku: string; mfr?: string; category?: string };
export type MfrPageVendorInfo = { name: string; lastList?: { receivedAt: number; effectiveAt: number } | null; terms: string; manufacturers?: string[] };

export type MfrPageInput = {
  key: string;
  records: readonly MfrPageRecord[];
  parts: readonly MfrPagePart[];
  ownPhoto: (sku: string) => boolean;
  vendorOwnerByKey: ReadonlyMap<string, string>;
  vendors: ReadonlyMap<string, MfrPageVendorInfo>;
  company: { id: string; name: string } | null;
  sites: { name: string; address: string; city: string; state: string }[];
  companyPeople: { id: string; name: string; title: string; email: string; phone: string }[];
  reps: { contactId: string; name: string; company: string; role: string; companyId?: string | null }[];
  priceBookAt: number | null;
};

export type MfrPageVM = {
  key: string;
  name: string;
  spellings: { name: string; href: string }[];
  aliasKeys: string[];
  aliases: { key: string; name: string }[];
  imageDocumentId: string | null;
  vendors: { id: string; name: string; href: string; lastList: { receivedAt: number; effectiveAt: number } | null; terms: string; claimed: string[] }[];
  company: { id: string; name: string } | null;
  sites: MfrPageInput["sites"];
  companyPeople: MfrPageInput["companyPeople"];
  reps: MfrPageInput["reps"];
  notes: string;
  catalog: { parts: number; withoutPhoto: number; topCategories: { name: string; count: number }[]; priceBookAt: number | null };
};

export const catalogHref = (spelling: string) => `/catalog?mfr=${encodeURIComponent(spelling)}`;

export function manufacturerPageVM(input: MfrPageInput): MfrPageVM {
  const canon = canonicalKeyMap(input.records);
  const key = canon(input.key);
  const group = groupKeys(input.records, key);
  const inGroup = new Set(group);
  const record = input.records.find((r) => r.key === key) ?? null;

  const counts = new Map<string, Map<string, number>>(); // key → spelling → parts
  const cats = new Map<string, number>();
  let parts = 0;
  let withoutPhoto = 0;
  for (const p of input.parts) {
    if (p.category === "Labor") continue;
    const name = String(p.mfr ?? "").trim();
    const k = mfrKey(name);
    if (!k || !inGroup.has(canon(k))) continue;
    let m = counts.get(k);
    if (!m) counts.set(k, (m = new Map()));
    m.set(name, (m.get(name) ?? 0) + 1);
    parts++;
    if (!input.ownPhoto(p.sku)) withoutPhoto++;
    const c = String(p.category ?? "").trim() || "Uncategorized";
    cats.set(c, (cats.get(c) ?? 0) + 1);
  }

  const tally = new Map<string, number>();
  for (const m of counts.values()) for (const [n, c] of m) tally.set(n, (tally.get(n) ?? 0) + c);
  const bySpelling = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
  // Keys in the group with no parts of their own still get a link, under the record's name.
  const named = new Set(bySpelling.map(mfrKey));
  for (const k of group) {
    if (named.has(k)) continue;
    const r = input.records.find((x) => x.key === k);
    const n = (r?.name || "").trim() || k;
    if (!bySpelling.includes(n)) bySpelling.push(n);
  }
  const name = bySpelling[0] ?? (record?.name || "").trim() ?? key;
  const spellings = bySpelling.map((n) => ({ name: n, href: catalogHref(n) }));

  const aliasName = (k: string) => {
    const m = counts.get(k);
    if (m) return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    return (input.records.find((r) => r.key === k)?.name || "").trim() || k;
  };
  const aliasKeys = group.filter((k) => k !== key);

  const seen = new Set<string>();
  const vendors: MfrPageVM["vendors"] = [];
  for (const k of group) {
    const id = input.vendorOwnerByKey.get(k);
    if (!id || seen.has(id)) continue;
    const v = input.vendors.get(id);
    if (!v) continue;
    seen.add(id);
    vendors.push({
      id,
      name: v.name,
      href: `/vendors/${encodeURIComponent(id)}`,
      lastList: v.lastList ?? null,
      terms: v.terms,
      claimed: (v.manufacturers ?? []).filter((m) => inGroup.has(canon(mfrKey(m)))),
    });
  }

  return {
    key,
    name: name || key,
    spellings,
    aliasKeys,
    aliases: aliasKeys.map((k) => ({ key: k, name: aliasName(k) })),
    imageDocumentId: record?.imageDocumentId ?? null,
    vendors,
    company: input.company,
    sites: input.sites,
    companyPeople: input.companyPeople,
    reps: input.reps,
    notes: record?.notes ?? "",
    catalog: {
      parts,
      withoutPhoto,
      topCategories: [...cats].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([n, count]) => ({ name: n, count })),
      priceBookAt: input.priceBookAt,
    },
  };
}

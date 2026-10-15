/**
 * The Companies directory's rules (Jeff 2026-10-15 #11), pure so the harness
 * can check them against a full set: each company's open value / quote count /
 * owner rollup, and the scope · type · search · "added in 7 days" filters. The
 * page runs these over EVERY company and only then cuts a 50-row page
 * (src/lib/list-paging.ts), so no filter or count ever sees just one page.
 */

export type DirectoryCompany = {
  id: string;
  name: string;
  type?: string | null;
  owner?: string | null;
  createdAt?: number | null;
  locations?: ReadonlyArray<{ label?: string | null; city?: string | null; state?: string | null; address?: string | null; zip?: string | null }>;
};
export type DirectoryQuote = { customerId?: string | null; customer?: string; status: string; value?: number; owner?: string; updatedAt?: number };
export type DirectoryProject = { customerId?: string | null; owner?: string; updatedAt?: number };

export type DirectoryRow<C extends DirectoryCompany = DirectoryCompany> = {
  c: C;
  openValue: number;
  quoteCount: number;
  /** The stored owner, else whoever touched the company's latest quote/project (D83). */
  owner: string;
};

/** One row per company with its rollups — quotes match by customerId, or by name when unlinked. */
export function companyRollups<C extends DirectoryCompany>(
  customers: readonly C[],
  quotes: readonly DirectoryQuote[],
  projects: readonly DirectoryProject[]
): DirectoryRow<C>[] {
  const byId = new Map<string, DirectoryQuote[]>();
  const byName = new Map<string, DirectoryQuote[]>();
  for (const q of quotes) {
    const key = q.customerId || q.customer;
    if (!key) continue;
    const idx = q.customerId ? byId : byName;
    const list = idx.get(key);
    if (list) list.push(q);
    else idx.set(key, [q]);
  }
  const projBy = new Map<string, DirectoryProject[]>();
  for (const p of projects) {
    if (p.customerId == null) continue;
    const list = projBy.get(p.customerId);
    if (list) list.push(p);
    else projBy.set(p.customerId, [p]);
  }
  return customers.map((c) => {
    const qs = [...(byId.get(c.id) ?? []), ...(c.name ? byName.get(c.name) ?? [] : [])];
    const openValue = qs.filter((q) => q.status === "draft" || q.status === "sent").reduce((a, q) => a + (q.value || 0), 0);
    const acts = [
      ...qs.map((q) => ({ at: q.updatedAt || 0, owner: q.owner || "" })),
      ...(projBy.get(c.id) ?? []).map((p) => ({ at: p.updatedAt || 0, owner: p.owner || "" })),
    ].filter((r) => r.owner);
    acts.sort((a, b) => b.at - a.at);
    return { c, openValue, quoteCount: qs.length, owner: c.owner || acts[0]?.owner || "" };
  });
}

/** The text a directory search reads for one company (name, type, and every venue's label/address/city/state/zip). */
export function companySearchText(c: DirectoryCompany): string {
  return (
    c.name +
    " " +
    (c.type || "") +
    " " +
    (c.locations || []).map((l) => [l.label, l.address, l.city, l.state, l.zip].filter(Boolean).join(" ")).join(" ")
  ).toLowerCase();
}

export type DirectoryFilters = {
  /** "all" | "mine" | a teammate's name */
  scope: string;
  me: string;
  /** "all" or a company type */
  type: string;
  q: string;
  /** "7d" = only companies added in the last 7 days */
  added: string;
  /** Companies a contact search matched (name, title or email — companyIdsWithContactMatching). */
  contactHits?: ReadonlySet<string>;
  now?: number;
};

/** Scope + type + search over every row; `addedCount` counts the 7-day rows among those; `filtered` applies `added`. */
export function filterCompanyDirectory<R extends DirectoryRow<DirectoryCompany>>(rows: readonly R[], f: DirectoryFilters): { filtered: R[]; addedCount: number } {
  const ql = f.q.trim().toLowerCase();
  const pre = rows.filter(({ c, owner }) => {
    if (f.scope === "mine" && owner !== f.me) return false;
    if (f.scope !== "all" && f.scope !== "mine" && owner !== f.scope) return false;
    if (f.type !== "all" && c.type !== f.type) return false;
    if (ql && !companySearchText(c).includes(ql) && !f.contactHits?.has(c.id)) return false;
    return true;
  });
  const since7 = (f.now ?? Date.now()) - 7 * 86_400_000;
  const recent = (r: R) => (r.c.createdAt ?? 0) >= since7;
  const addedCount = pre.filter(recent).length;
  return { filtered: f.added === "7d" ? pre.filter(recent) : pre, addedCount };
}

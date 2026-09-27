"use client";

import { SearchFilterBar } from "@/components/search/search-filter-bar";
import { useUrlSearchText } from "@/lib/use-url-search-text";

/**
 * Client bits for the People directory (identity core, D85): the search /
 * company / status filter bar — URL-as-state with a debounced search box,
 * same pattern as the Companies FilterBar.
 */

export function PeopleFilterBar({
  q,
  company,
  status,
  companyOptions,
  statusOptions,
}: {
  q: string;
  company: string;
  status: string;
  companyOptions: Array<{ id: string; name: string }>;
  statusOptions: Array<{ value: string; label: string }>;
}) {
  // #243: the draft never gets overwritten by its own slow navigation.
  const { text, setSearch, go } = useUrlSearchText(q);

  const hrefWith = (patch: { q?: string; company?: string; status?: string }) => {
    const p = new URLSearchParams();
    const nq = patch.q !== undefined ? patch.q : text;
    const nc = patch.company !== undefined ? patch.company : company;
    const ns = patch.status !== undefined ? patch.status : status;
    if (nq.trim()) p.set("q", nq.trim());
    if (nc && nc !== "all") p.set("company", nc);
    // "active" is the default view (spec §5.4) — only non-defaults go in the URL.
    if (ns && ns !== "active") p.set("status", ns);
    const s = p.toString();
    return "/people" + (s ? "?" + s : "");
  };
  const pushWith = (patch: { company?: string; status?: string }) => go(hrefWith(patch));
  const onSearch = (v: string) => setSearch(v, hrefWith({ q: v }));

  return (
    <div style={{ marginBottom: 14 }}>
      {/* #121: the filter selects ride on the search row. */}
      <SearchFilterBar value={text} onChange={onSearch} placeholder="Search people…" ariaLabel="Search people">
        <select
          className="pk-searchbar-select"
          value={status}
          onChange={(e) => pushWith({ status: e.target.value })}
          aria-label="Status filter"
        >
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="pk-searchbar-select"
          value={company}
          onChange={(e) => pushWith({ company: e.target.value })}
          aria-label="Company filter"
        >
          <option value="all">All companies</option>
          {companyOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </SearchFilterBar>
    </div>
  );
}

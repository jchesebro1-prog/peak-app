"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchFilterBar } from "@/components/search/search-filter-bar";

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
  const router = useRouter();
  const [text, setText] = useState(q);
  const [prevQ, setPrevQ] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset the draft text when the URL's q changes (derived-state reset
  // during render — avoids the set-state-in-effect cascade).
  if (prevQ !== q) {
    setPrevQ(q);
    setText(q);
  }

  const pushWith = (patch: { q?: string; company?: string; status?: string }) => {
    const p = new URLSearchParams();
    const nq = patch.q !== undefined ? patch.q : text;
    const nc = patch.company !== undefined ? patch.company : company;
    const ns = patch.status !== undefined ? patch.status : status;
    if (nq.trim()) p.set("q", nq.trim());
    if (nc && nc !== "all") p.set("company", nc);
    // "active" is the default view (spec §5.4) — only non-defaults go in the URL.
    if (ns && ns !== "active") p.set("status", ns);
    const s = p.toString();
    router.push("/people" + (s ? "?" + s : ""));
  };

  const onSearch = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => pushWith({ q: v }), 300);
  };

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

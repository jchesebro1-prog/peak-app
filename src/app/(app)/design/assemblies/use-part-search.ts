"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Debounce + stale-response guard for a server-searched part picker (#121/I1)
 * — the same pattern as the Estimator's catalog-picker.tsx, generalized:
 * `items`/`pending` are DERIVED from whether `resultQuery` (what the last
 * completed search answered) still matches the live `query`, rather than
 * reset with their own setState calls — an empty/changed query needs no
 * effect-body state write, it just falls out of the comparison below.
 * #296: shared by the Assembly Builder's pickers and the rack sidebar.
 */
export function usePartSearch<H>(search: (q: string) => Promise<H[]>) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<H[]>([]);
  const [resultQuery, setResultQuery] = useState("");
  const seq = useRef(0);
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      searchRef.current(q).then((hits) => {
        if (my !== seq.current) return; // a newer keystroke superseded this request
        setResults(hits);
        setResultQuery(q);
      });
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  const trimmed = query.trim();
  const fresh = trimmed !== "" && resultQuery === trimmed;
  const items = fresh ? results : [];
  const pending = trimmed !== "" && !fresh;
  const emptyText = pending ? "Searching…" : trimmed ? "No parts match." : "Start typing to search the catalog.";
  return { query, setQuery, items, pending, emptyText };
}

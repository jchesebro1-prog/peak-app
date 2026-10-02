"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_LIBRARY_SKUS, type KeyProductLibraryRow } from "./narrative";
import { keyProductLibraryAction } from "./narrative-actions";

/** #293 — the narrative column's per-sku library cache (paragraph, stamp,
 *  description, primary photo). Prefetches the ACTIVE system's eligible skus
 *  whenever that set changes, so a ★ click can copy the saved paragraph; the
 *  full catalog never ships to the client. */
export type KeyProductLibrary = {
  rows: Record<string, KeyProductLibraryRow>;
  /** Fetch any of `skus` not cached yet; resolves to the whole cache. */
  ensure: (skus: string[]) => Promise<Record<string, KeyProductLibraryRow>>;
  /** Re-read `skus` even when cached (Draft narrative copies the CURRENT
   *  library paragraph); resolves to the whole cache. Rejects on failure. */
  refresh: (skus: string[]) => Promise<Record<string, KeyProductLibraryRow>>;
  /** Replace one row (after Save to library). */
  setRow: (sku: string, row: KeyProductLibraryRow) => void;
};

export function useKeyProductLibrary(activeSkus: string[]): KeyProductLibrary {
  const [rows, setRows] = useState<Record<string, KeyProductLibraryRow>>({});
  const rowsRef = useRef(rows);

  const ensure = useCallback(async (skus: string[]) => {
    const missing = [...new Set(skus.map((s) => (s || "").trim()).filter(Boolean))]
      .filter((s) => !(s in rowsRef.current))
      .slice(0, MAX_LIBRARY_SKUS);
    if (!missing.length) return rowsRef.current;
    try {
      const got = await keyProductLibraryAction(missing);
      const next = { ...rowsRef.current, ...got };
      rowsRef.current = next;
      setRows(next);
      return next;
    } catch {
      return rowsRef.current; // offline / transient — the chips just stay blank
    }
  }, []);

  const refresh = useCallback(async (skus: string[]) => {
    const want = [...new Set(skus.map((s) => (s || "").trim()).filter(Boolean))].slice(0, MAX_LIBRARY_SKUS);
    if (!want.length) return rowsRef.current;
    const got = await keyProductLibraryAction(want);
    const next = { ...rowsRef.current, ...got };
    rowsRef.current = next;
    setRows(next);
    return next;
  }, []);

  const setRow = useCallback((sku: string, row: KeyProductLibraryRow) => {
    const next = { ...rowsRef.current, [sku]: row };
    rowsRef.current = next;
    setRows(next);
  }, []);

  const key = [...new Set(activeSkus.map((s) => (s || "").trim()).filter(Boolean))].sort().join("\n");
  useEffect(() => {
    if (key) void ensure(key.split("\n"));
  }, [key, ensure]);

  return { rows, ensure, refresh, setRow };
}

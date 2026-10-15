/**
 * Directory paging (Jeff 2026-10-15 #11) — the Companies, Quotes and Venues
 * lists show 50 rows a page with Prev / Next and "Page X of Y", the page kept
 * in the URL as `?page=`. Pure and store-free: every filter, chip count, sort
 * and stat runs over the FULL filtered set first; this only cuts the page out
 * of it, so a filter can never act on the current page alone.
 */

export const LIST_PAGE_SIZE = 50;

/** `?page=` → a 1-based page number; anything not a positive integer is page 1. */
export function parsePageParam(raw: string | null | undefined): number {
  const s = String(raw ?? "").trim();
  if (!/^\d{1,6}$/.test(s)) return 1;
  const n = Number(s);
  return n >= 1 ? n : 1;
}

export type Paged<T> = {
  rows: T[];
  /** The page actually shown — the asked-for page clamped to [1, pageCount]. */
  page: number;
  /** At least 1, so an empty list still reads "Page 1 of 1". */
  pageCount: number;
  total: number;
  /** 1-based index of the first row shown (0 when there are none). */
  from: number;
  /** 1-based index of the last row shown (0 when there are none). */
  to: number;
};

export function pageCountFor(total: number, size = LIST_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, size)));
}

/** The page of `all` to render. A page past the end shows the last page. */
export function paginate<T>(all: readonly T[], page: number, size = LIST_PAGE_SIZE): Paged<T> {
  const total = all.length;
  const pageCount = pageCountFor(total, size);
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (p - 1) * size;
  const rows = all.slice(start, start + size);
  return { rows, page: p, pageCount, total, from: rows.length ? start + 1 : 0, to: start + rows.length };
}

/** The page holding the row at `index` (0-based) — how a `?id=` link opens on its row's page. */
export function pageOfIndex(index: number, size = LIST_PAGE_SIZE): number {
  return index < 0 ? 1 : Math.floor(index / Math.max(1, size)) + 1;
}

/**
 * The page to show: the selected row's page when `selectedIndex` finds it in
 * the filtered set (a bell / search link like `/quotes?id=…` lands on its row),
 * else the `?page=` the URL asked for.
 */
export function resolvePage(askedPage: number, selectedIndex: number, size = LIST_PAGE_SIZE): number {
  return selectedIndex >= 0 ? pageOfIndex(selectedIndex, size) : askedPage;
}

/** `base` + the given params, with `page` set (page 1 is left out so the first page keeps its plain URL). */
export function withPage(base: string, params: URLSearchParams, page: number): string {
  const p = new URLSearchParams(params);
  p.delete("page");
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return base + (s ? "?" + s : "");
}

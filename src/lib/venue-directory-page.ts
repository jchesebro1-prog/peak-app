export type DirectoryPage<T> = {
  rows: T[];
  page: number;
  totalPages: number;
  totalRows: number;
};

/** Bound a directory result before it becomes server-component markup. */
export function venueDirectoryPage<T>(
  rows: readonly T[],
  requestedPage: number,
  pageSize: number,
): DirectoryPage<T> {
  const safeSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 50;
  const totalPages = Math.max(1, Math.ceil(rows.length / safeSize));
  const numericPage = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1;
  const page = Math.min(totalPages, Math.max(1, numericPage));
  const start = (page - 1) * safeSize;
  return {
    rows: rows.slice(start, start + safeSize),
    page,
    totalPages,
    totalRows: rows.length,
  };
}

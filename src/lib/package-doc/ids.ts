import { splitLineRef } from "./chips";
import { walkDoc } from "./text";
import type { PackageDoc } from "./types";

/**
 * Estimator Phase 5 — id reuse guard. The Estimator mints system ids as
 * `sys<N>` and line ids as numbers from one counter seeded on load. A chip or
 * product block stores such an id; if the counter were seeded only from the
 * CURRENT sections, deleting the highest system/line and reloading would
 * reissue its id and an old reference would silently re-bind to the new one.
 * docIdFloor is the highest numeric id the document refers to, so the counter
 * starts above it. Ids beyond MAX_FLOOR are ignored (a hostile document can't
 * push the counter out of range). Pure; client-safe.
 */

const MAX_FLOOR = 1e9;
const SYS_RE = /^sys(\d+)$/;
const NUM_RE = /^\d+$/;

function bump(cur: number, raw: string | undefined, re: RegExp): number {
  const m = typeof raw === "string" ? re.exec(raw) : null;
  if (!m) return cur;
  const n = parseInt(m[1] ?? m[0], 10);
  return Number.isFinite(n) && n <= MAX_FLOOR ? Math.max(cur, n) : cur;
}

export function docIdFloor(doc: PackageDoc | null | undefined): number {
  let n = 0;
  for (const node of walkDoc(doc)) {
    if (node.type === "chip") {
      const { kind, ref } = node.attrs;
      if (kind === "systemPrice" || kind === "systemName") n = bump(n, ref, SYS_RE);
      else if (kind === "lineQty") {
        const r = splitLineRef(ref);
        if (r) {
          n = bump(n, r.sectionId, SYS_RE);
          n = bump(n, r.lineKey, NUM_RE);
        }
      }
    } else if (node.type === "productBlock") {
      n = bump(n, node.attrs.sectionId, SYS_RE);
      n = bump(n, node.attrs.lineKey, NUM_RE);
    }
  }
  return n;
}

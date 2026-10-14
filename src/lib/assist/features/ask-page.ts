/**
 * Ask AI page context (spec 2026-10-13-ask-ai-design.md §3) — which record
 * the panel was opened over, from `location.pathname + search`. Pure route
 * parsing; the server loads the record under the user's access rule.
 *
 * Query-param names verified 2026-10-13: the Inbox reads `?thread=` and, in
 * the Meetings box (`?view=meetings`), `?m=` (spec said `meeting=`); Leads
 * reads `?lead=`; the Estimator and the service / consulting / rental
 * builders read `?id=` (quoteBuilderHref's routes).
 */
import { REF_ID_MAX, type AskRef } from "./ask-refs";

export const ASK_PAGE_MAX = 500;

/** Every builder route quoteBuilderHref() hands out — all read `?id=`. */
const QUOTE_BUILDER_PATHS: ReadonlySet<string> = new Set([
  "/estimator",
  "/flame-tests/quote",
  "/repairs/quote",
  "/inspections/quote",
  "/design/engagements/quote",
  "/rentals/quote",
]);

/** `/<base>/<id>` record pages (one segment after the base, nothing deeper). */
const SEGMENT_PAGES: Record<string, AskRef["kind"]> = {
  companies: "company",
  venues: "venue",
  projects: "project",
  "venue-assessments": "survey",
};

function cleanId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t || t.length > REF_ID_MAX || /[\r\n\]\[]/.test(t)) return null;
  return t;
}

export function parsePage(path: string | null | undefined): AskRef | null {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.length > ASK_PAGE_MAX) return null;
  let url: URL;
  try {
    url = new URL(path, "http://peak.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "http://peak.invalid") return null;
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const q = url.searchParams;

  if (QUOTE_BUILDER_PATHS.has(pathname)) {
    const id = cleanId(q.get("id"));
    return id ? { kind: "quote", id } : null;
  }
  if (pathname === "/inbox") {
    if (q.get("view") === "meetings") {
      const id = cleanId(q.get("m"));
      return id ? { kind: "meeting", id } : null;
    }
    const id = cleanId(q.get("thread"));
    return id ? { kind: "thread", id } : null;
  }
  if (pathname === "/leads") {
    const id = cleanId(q.get("lead"));
    return id ? { kind: "lead", id } : null;
  }
  const segs = pathname.split("/").slice(1);
  if (segs.length === 2 && SEGMENT_PAGES[segs[0]]) {
    let id: string | null;
    try {
      id = cleanId(decodeURIComponent(segs[1]));
    } catch {
      return null;
    }
    return id ? { kind: SEGMENT_PAGES[segs[0]], id } : null;
  }
  return null;
}

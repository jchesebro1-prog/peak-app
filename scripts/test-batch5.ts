/* Jeff's 2026-10-15 decisions — Batch 5 (estimate output leftovers) harness checks
   (docs/decisions/2026-10-15-jeff-decisions.md, Round 2 items 55–63).
   `batch5PureChecks` needs no database; `batch5DbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-batch5.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Ok } from "./test-inbox-org";
import { coverDocumentPropsFor, coverScopeHeading } from "../src/lib/estimate-output/cover";
import CoverDocument from "../src/components/estimate-output/cover-document";
import { qdP2bNoAltCases } from "./qd293-cases";
import { lastViewedAt, opensChip, viewedStamp } from "../src/lib/quote-share/package-view";
import type { QuoteRevision } from "../src/lib/stores/quotes";

const ROOT = join(__dirname, "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* --- #56 a heading for each scope on the cover PDF --- */
function coverHeadingChecks(ok: Ok) {
  ok(coverScopeHeading({ name: "  Stage lighting ", discipline: "rigging", num: 1 }) === "Stage lighting", "#56: the heading is the system's own name (trimmed) when it has one");
  ok(coverScopeHeading({ name: " ", discipline: "curtain", num: 2 }) === "Curtains", "#56: a blank name falls back to the discipline label");
  ok(coverScopeHeading({ name: "", discipline: null, num: 3 }) === "Scope 3", "#56: no name and no discipline reads 'Scope N'");
  const docs = Object.values(qdP2bNoAltCases());
  let checked = 0;
  for (const doc of docs) {
    const props = coverDocumentPropsFor({ doc, coverSummary: "", notIncluded: "", signer: null, footerLine: "x", shareUrl: null, letterhead: { src: "/lh.jpg", full: true } });
    const html = renderToStaticMarkup(createElement(CoverDocument, props));
    for (const s of props.scopes) {
      checked++;
      ok(!!s.heading && html.includes(`<h2 class="cov-scope-h"`) && html.includes(`>${s.heading.replace(/&/g, "&amp;")}</h2>`), `#56: scope ${s.id} prints its heading "${s.heading}"`);
    }
    ok((html.match(/class="cov-scope-h"/g) || []).length === props.scopes.length, "#56: exactly one heading per printed scope");
  }
  ok(checked > 0, "#56: the fixture cases carry scopes");
  const cd = src("src/components/estimate-output/cover-document.tsx");
  ok(/className="cov-scope"[\s\S]{0,120}<h2 className="cov-scope-h"/.test(cd), "#56: the heading sits inside the scope's break-inside: avoid block (never orphaned from its paragraph)");
}

/* --- #58 "Viewed <date time>" for staff --- */
function viewedChecks(ok: Ok) {
  const T1 = Date.UTC(2026, 9, 5, 15);
  const T2 = Date.UTC(2026, 9, 6, 20, 42);
  const T3 = Date.UTC(2026, 9, 7, 2, 5);
  const rev = (n: number, reason: string, at: number) => ({ rev: n, reason, at, by: "x", spec: { sections: [] } }) as unknown as QuoteRevision;
  const revs = [rev(1, "sent", T1), rev(2, "sent", T2)];
  ok(lastViewedAt({ revisions: revs }) === null && viewedStamp({ revisions: revs }) === "" && viewedStamp(null) === "", "#58: never opened → no stamp");
  const q = { revisions: revs, shareOpens: { "1": { first: T1, last: T3, count: 4 }, "2": { first: T2, last: T2, count: 1 } } };
  ok(lastViewedAt(q) === T3, "#58: the stamp is the latest open across every sent revision (a superseded rev's later open counts)");
  ok(viewedStamp(q) === "Viewed Oct 6, 9:05 PM", "#58: the stamp is in Chicago time, date and time (02:05 UTC Oct 7 = 9:05 PM CDT Oct 6)");
  ok(lastViewedAt({ revisions: [rev(1, "manual", T1)], shareOpens: { "1": { first: T1, last: T3, count: 1 } } }) === null, "#58: opens of a never-sent revision don't stamp");
  ok(opensChip(q)?.title.startsWith("Viewed Oct 6, 9:05 PM — Client link — ") === true, "#58: the Quotes hub's Opened chip tooltip leads with the Viewed stamp");
  const panel = src("src/app/(app)/estimator/client-link-panel.tsx");
  ok(panel.includes('data-testid="client-link-viewed"') && panel.includes("{status.viewed}"), "#58: Send & track's Client link panel shows the Viewed stamp");
  ok(/sentRevs: sentRevisionRows\(q\), viewed: viewedStamp\(q\) \}/.test(src("src/lib/quote-share/links.ts")), "#58: the panel's status carries the stamp (staff-only server action)");
  for (const f of ["src/app/share/quote/[id]/[token]/page.tsx", "src/app/share/quote/[id]/[token]/package-page.tsx", "src/app/share/quote/[id]/[token]/package-slots.tsx",
    "src/components/estimate-output/package-view.tsx", "src/lib/estimate-output/package-model.ts", "src/app/portal/quotes/[id]/page.tsx", "src/app/portal/quotes/[id]/bom-view.tsx"]) {
    const t = src(f);
    ok(!t.includes("viewedStamp") && !t.includes("lastViewedAt") && !t.includes("COPY.viewed") && !t.includes("shareOpens"), `#58: the customer never sees it — ${f} reads no open stamp`);
  }
}

export async function batch5PureChecks(ok: Ok) {
  coverHeadingChecks(ok);
  viewedChecks(ok);
}

export async function batch5DbChecks(ok: Ok) {
  void ok;
}

if (process.argv[1]?.endsWith("test-batch5.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  const db = !!process.env.PGLITE_PATH;
  batch5PureChecks(okf)
    .then(() => (db ? batch5DbChecks(okf) : undefined))
    .then(() => { console.log(`${pass} PASS, ${fail} FAIL${db ? "" : " (pure only — set PGLITE_PATH for the DB half)"}`); process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); process.exit(1); });
}

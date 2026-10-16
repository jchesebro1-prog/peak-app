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

export async function batch5PureChecks(ok: Ok) {
  coverHeadingChecks(ok);
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

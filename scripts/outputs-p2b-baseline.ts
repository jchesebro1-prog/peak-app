/** Estimator Phase 2b (Task 5) — writes the pre-change cover / package page /
 *  scope picker output of quotes without alternates, which the harness
 *  compares against. Run ONCE, before the estimate-output modules are edited:
 *    npx tsx scripts/outputs-p2b-baseline.ts
 *  Pure; opens no database. */
import { mkdirSync, writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { qdP2bNoAltCases } from "./qd293-cases";
import { coverDocumentPropsFor } from "@/lib/estimate-output/cover";
import CoverDocument from "@/components/estimate-output/cover-document";
import { packageViewModel } from "@/lib/estimate-output/package-model";
import PackageView from "@/components/estimate-output/package-view";
import { responseScopes } from "@/lib/estimate-output/responses";
import type { QuoteDocumentProps } from "@/app/(app)/estimator/quote-document";

export function outputsP2bCase(doc: QuoteDocumentProps) {
  const cover = coverDocumentPropsFor({ doc, coverSummary: "", notIncluded: "Permits", signer: null, footerLine: "Peak · x", shareUrl: "https://app.test/s", letterhead: { src: "/lh.jpg", full: true } });
  const pkg = packageViewModel({ doc, photos: {}, catalog: new Map(), frozen: { coverSummary: "", notIncluded: "Permits" }, state: { kind: "ok", rev: { rev: 1 }, closed: false, won: false } as never,
    headerLine: "EST-1 · Rev 1", currentHref: null, view: "narrative", base: "/b", letterheadSrc: "/lh.jpg" });
  return {
    cover: JSON.stringify(cover),
    coverHtml: renderToStaticMarkup(createElement(CoverDocument, cover)),
    pkg: JSON.stringify(pkg),
    pkgHtml: renderToStaticMarkup(createElement(PackageView, { model: pkg })),
    scopes: JSON.stringify(responseScopes(doc.sections)),
  };
}

if (process.argv[1] && process.argv[1].endsWith("outputs-p2b-baseline.ts")) {
  const out = Object.fromEntries(Object.entries(qdP2bNoAltCases()).map(([k, p]) => [k, outputsP2bCase(p)]));
  mkdirSync("docs/superpowers/fixtures", { recursive: true });
  writeFileSync("docs/superpowers/fixtures/p2b-outputs-no-alternates.json", JSON.stringify(out, null, 1) + "\n");
  console.log("wrote", Object.keys(out).length, "cases");
}

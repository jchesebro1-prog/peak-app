/**
 * core:golden — golden totals for Estimator system quotes (estimator handoff,
 * spec docs/superpowers/specs/2026-10-20-estimator-handoff-package-design.md §6).
 *
 * Prices every live system quote in a db:export file with the Estimator's own
 * pricing and writes one JSON per quote: per-system sell, per-line extended
 * sell, and totals(). The same files prove the engine move changed nothing
 * (PR 1) and that the handoff prototype prices to the cent (PR 2).
 *
 *   npm run core:golden -- --in <export.json> --out <dir>     write <quoteId>.json files
 *   npm run core:golden -- --in <export.json> --check <dir>   recompute, compare byte for byte
 *   test:specs → goldenChecks(ok) over docs/estimating-core/golden-fixtures + golden
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { lineExtSellOf, systemSellTotal, totals, type QuoteTotals } from "@/app/(app)/estimator/pricing";
import type { SpecSection } from "@/app/(app)/estimator/types";
import type { Ok } from "./test-inbox-org";

/** use-estimator-state.ts TAX_RATE_PCT — the Estimator prices with no tax. */
export const GOLDEN_TAX_RATE_PCT = 0;
export const FIXTURE_EXPORT = "docs/estimating-core/golden-fixtures/export.json";
export const FIXTURE_GOLDEN = "docs/estimating-core/golden";

type ExportRow = { id: string; doc?: unknown; deleted?: boolean | null };
export type ExportFile = { collections?: { quotes?: ExportRow[] } };
export type SystemQuote = { id: string; estNo: number | null; sections: SpecSection[] };
export type GoldenQuote = {
  id: string;
  estNo: number | null;
  systems: Array<{
    id: string;
    name: string;
    alternate: boolean;
    sell: number;
    lines: Array<{ id: number; sku: string; ext: number }>;
  }>;
  totals: QuoteTotals;
};

/** Live system quotes with at least one line, sorted by id. */
export function systemQuotesOf(file: ExportFile): SystemQuote[] {
  const out: SystemQuote[] = [];
  for (const row of file.collections?.quotes ?? []) {
    if (row.deleted) continue;
    const doc = (row.doc ?? {}) as { quoteType?: string; estNo?: unknown; spec?: { sections?: unknown } };
    if ((doc.quoteType ?? "system") !== "system") continue;
    const sections = doc.spec?.sections;
    if (!Array.isArray(sections)) continue;
    const secs = sections as SpecSection[];
    if (!secs.some((s) => Array.isArray(s.items) && s.items.length > 0)) continue;
    out.push({ id: row.id, estNo: typeof doc.estNo === "number" ? doc.estNo : null, sections: secs });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function goldenFor(q: SystemQuote): GoldenQuote {
  return {
    id: q.id,
    estNo: q.estNo,
    systems: q.sections.map((s) => ({
      id: s.id,
      name: s.name,
      alternate: s.alternate === true,
      sell: systemSellTotal(s),
      lines: (s.items ?? []).map((it) => ({ id: it.id, sku: it.sku, ext: lineExtSellOf(it) })),
    })),
    totals: totals(q.sections, GOLDEN_TAX_RATE_PCT),
  };
}

export const goldenFileName = (id: string) => `${id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
export const goldenJson = (g: GoldenQuote) => JSON.stringify(g, null, 2) + "\n";

export function writeGolden(file: ExportFile, dir: string): number {
  fs.mkdirSync(dir, { recursive: true });
  const quotes = systemQuotesOf(file);
  for (const q of quotes) fs.writeFileSync(path.join(dir, goldenFileName(q.id)), goldenJson(goldenFor(q)));
  return quotes.length;
}

/** Problems found comparing a fresh run against `dir`; [] = identical. */
export function checkGolden(file: ExportFile, dir: string): string[] {
  const problems: string[] = [];
  const expected = new Set(fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : []);
  for (const q of systemQuotesOf(file)) {
    const name = goldenFileName(q.id);
    if (!expected.has(name)) { problems.push(`${name}: no golden file`); continue; }
    expected.delete(name);
    if (fs.readFileSync(path.join(dir, name), "utf8") !== goldenJson(goldenFor(q))) problems.push(`${name}: totals differ`);
  }
  for (const extra of expected) problems.push(`${extra}: golden file has no matching quote`);
  return problems;
}

const readExport = (p: string) => JSON.parse(fs.readFileSync(p, "utf8")) as ExportFile;

export async function goldenChecks(ok: Ok) {
  const file = readExport(FIXTURE_EXPORT);
  const quotes = systemQuotesOf(file);
  ok(quotes.map((q) => q.id).join(",") === "Q-G001,Q-G002,Q-G003",
    "core:golden: only live system quotes with lines (deleted, flame-test and empty quotes skipped)");
  const problems = checkGolden(file, FIXTURE_GOLDEN);
  ok(problems.length === 0, `core:golden: fixture totals match ${FIXTURE_GOLDEN}` + (problems.length ? ` — ${problems.join("; ")}` : ""));
  const alt = goldenFor(quotes[1]);
  ok(alt.totals.alt === alt.systems[1].sell && alt.totals.rev === alt.systems[0].sell,
    "core:golden: an alternate system prices into totals.alt only, never rev");
}

if (process.argv[1]?.endsWith("estimating-golden.ts")) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  const input = arg("--in"), out = arg("--out"), check = arg("--check");
  if (!input || (!out && !check)) {
    console.error("usage: npm run core:golden -- --in <export.json> (--out <dir> | --check <dir>)");
    process.exit(2);
  }
  const file = readExport(input);
  if (out) {
    console.log(`wrote ${writeGolden(file, out)} golden file(s) to ${out}`);
  } else {
    const problems = checkGolden(file, check!);
    if (problems.length) { console.error(`${problems.length} golden mismatch(es):\n  ${problems.join("\n  ")}`); process.exit(1); }
    console.log(`all ${systemQuotesOf(file).length} quote(s) match ${check}`);
  }
}

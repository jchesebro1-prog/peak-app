/**
 * Estimator handoff — `npm run handoff:verify -- --full [--allow-missing-features] [--out <package dir>]` (PR 2 Task 12): the
 * whole package, the way the founder gets it. Split out of verify.ts (which loads it on demand and owns the shared page
 * helpers). In order:
 *
 *   1. The folder (auditPackage): every file ≤ 15,000,000 bytes, the total ≤ 150 MB, no file contains a private Blob
 *      pathname ("part-docs/<id>/…"), the page / app / engine / docs / notice are all there.
 *   2. --parity (verify/parity.ts): the readable engine reproduces every golden file byte for byte.
 *   3. --smoke --all-steps over the sample: every route — each sampled estimate × each step and tab, the Catalog,
 *      Assemblies, a rack's sheets, Estimating Rules and its sub-pages — with no page error, no foreign request, no
 *      unregistered call. (A production slice can hold hundreds of estimates; --smoke --all-steps alone walks them all.)
 *   4. 1440×900 screenshots into the package's spec/screenshots/: the Estimates list, the four Estimator steps (on the
 *      sampled estimate with the most features), the Catalog, the Assembly Builder and Estimating Rules.
 *   5. A sample of SAMPLE_SIZE estimates (all when there are fewer; else a seeded, deterministic pick that first takes one
 *      estimate per feature — an alternate, a rack line, a curtain + track pair, bonus lines — found by reading
 *      spec.sections): each header's "Quoted total" equals the Estimator's post-load total (canonicalTotals) and each
 *      golden file's grand equals the stored sections' totals(). The two figures differ on purpose for a draft (golden =
 *      the engine over the stored data; the header = after the load re-derives bonus lines and the $25 round-up —
 *      pricing.md §12). Feature coverage is STRICT: a feature the sample doesn't cover fails the run (the production
 *      run must prove all four). `--allow-missing-features` (dev runs: the dev slice has no rack or curtain + track
 *      estimate) reports them instead.
 *   6. The edit → persist → Reset cycle in the UI: qty +1 → Save → a reload keeps it → Reset to production snapshot →
 *      the seed qty and header total are back.
 *   7. On PASS only, the zip is rewritten (it now carries the screenshots) and read back: same entries as the folder,
 *      every entry under peak-estimator-handoff/ (ZIP_ROOT), CONFIDENTIAL.txt first. The zip is deleted when --full
 *      starts and stays deleted on FAIL — only a passing --full produces it, so an unverified zip never sits there.
 * Result: output/verify/full.json.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import type { Page } from "puppeteer-core";
import { chromeLaunch } from "@/lib/quote-pdf/render";
import { fmt } from "@/lib/estimating-core/pricing";
import type { SpecItem, SpecSection } from "@/lib/estimating-core/types";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { isBonusItem } from "@/lib/estimate-bonus/flags";
import { normalizeSystemOrder, sanitizeGroups } from "@/lib/estimate-groups/groups";
import { goldenFileName } from "../../../scripts/estimating-golden";
import { canonicalTotals } from "../runtime/estimate-totals";
import { auditPackage, GOLDEN_DIR, SCREENSHOT_DIR, writeZip, ZIP_ROOT, zipDateOf, zipEntries, zipName, zipPathFor, type PackageAudit } from "../package";
import {
  clickButton, estimateUrl, firstQtyInput, loadSliceData, newPage, newSink, openUrl, pageHasText, printSmoke, readHeaderTotal, smoke,
  SMOKE_ALLOWED_UNREGISTERED, unregisteredOn, VERIFY_DIR, waitFor, waitMounted, type PageSink, type SliceQuote, type SmokeResult,
} from "../verify";
import { parityCheck, printParity, type ParityResult } from "./parity";

export const SAMPLE_SIZE = 20;
export const SAMPLE_SEED = "peak-estimator-handoff";
export const FEATURES = ["alternate", "rack", "curtainTrack", "bonus"] as const;
export type Feature = (typeof FEATURES)[number];
export const FEATURE_LABEL: Record<Feature, string> = {
  alternate: "an alternate (a system in an Alternate group)",
  rack: "a rack line (rackId)",
  curtainTrack: "a curtain + track pair (shared curtainTrackKey)",
  bonus: "bonus lines (stored, or derived on load)",
};

type Rules = { settings?: Record<string, unknown>; blobs?: Record<string, unknown> };
const sectionsOf = (q: SliceQuote): SpecSection[] => (Array.isArray(q.spec?.sections) ? (q.spec!.sections as SpecSection[]) : []);
const itemsOf = (q: SliceQuote): SpecItem[] => sectionsOf(q).flatMap((s) => (Array.isArray(s.items) ? s.items : []));
const generalOf = (rules: Rules) => ((rules.blobs ?? {}).pricing_rules ?? {}) as Record<string, unknown>;

/** The features an estimate exercises, read from its stored spec.sections (bonus also when the Estimator derives them on load). Pure. */
export function estimateFeatures(q: SliceQuote, rules: Rules): Set<Feature> {
  const out = new Set<Feature>();
  const ordered = normalizeSystemOrder(sectionsOf(q), sanitizeGroups(q.spec?.groups));
  if (ordered.some((s) => s.alternate === true)) out.add("alternate");
  const items = itemsOf(q);
  if (items.some((it) => typeof it.rackId === "string" && it.rackId !== "")) out.add("rack");
  const curtainKeys = new Set(items.filter((it) => it.curtain && it.curtainTrackKey).map((it) => it.curtainTrackKey!));
  if (items.some((it) => !!it.track && !!it.curtainTrackKey && curtainKeys.has(it.curtainTrackKey))) out.add("curtainTrack");
  if (items.some((it) => isBonusItem(it)) || canonicalTotals(q, generalOf(rules)).bonusLines) out.add("bonus");
  return out;
}

/** FNV-1a, 32-bit — a stable order key. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * The estimates --full opens: all of them when there are at most `n`; else, in a seeded order (FNV of seed + id), first
 * one estimate for each feature (FEATURES order) that the slice has, then the rest of the seeded order up to `n`. The
 * result keeps the seeded order. Pure and deterministic.
 */
export function sampleEstimates<Q extends { id: string }>(qs: readonly Q[], featuresOf: (q: Q) => Set<Feature>, n = SAMPLE_SIZE, seed = SAMPLE_SEED): Q[] {
  const ordered = [...qs].sort((a, b) => fnv(seed + a.id) - fnv(seed + b.id) || a.id.localeCompare(b.id));
  if (ordered.length <= n) return ordered;
  const pick = new Set<Q>();
  for (const f of FEATURES) {
    if ([...pick].some((q) => featuresOf(q).has(f))) continue;
    const hit = ordered.find((q) => !pick.has(q) && featuresOf(q).has(f));
    if (hit) pick.add(hit);
  }
  for (const q of ordered) {
    if (pick.size >= n) break;
    pick.add(q);
  }
  return ordered.filter((q) => pick.has(q));
}

type Step = { step: string; ok: boolean; detail?: string };
type EstimateRow = {
  id: string; number: string; features: Feature[]; pass: boolean;
  onScreen: string | null; expected: string; goldenGrand: number | null; rawGrand: number; goldenOk: boolean; numberShown: boolean;
};

export type FullResult = {
  pass: boolean;
  audit: Omit<PackageAudit, "files"> & { fileCount: number; largest: Array<{ file: string; bytes: number }> };
  parity: ParityResult;
  smoke: SmokeResult;
  sample: EstimateRow[];
  sliceSize: number;
  features: { covered: Feature[]; missing: Feature[]; inSlice: Feature[]; allowMissing: boolean };
  editCycle: Step[];
  screenshots: string[];
  unregistered: string[];
  zip: { file: string; bytes: number; entries: number; allUnderRoot: boolean; confidentialFirst: boolean; matchesFolder: boolean; screenshots: number } | null;
  zipRemoved: boolean;
} & PageSink;

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shot(page: Page, dir: string, name: string, list: string[]): Promise<void> {
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file as `${string}.png` });
  list.push(path.basename(file));
}

export async function fullCheck(pkgDir: string, opts: { allowMissingFeatures: boolean }): Promise<FullResult> {
  const index = path.join(pkgDir, "index.html");
  if (!existsSync(index)) throw new Error(`${index} not found — run npm run handoff:build first`);
  // only a passing run produces the zip: an old one goes now, so a crash or a FAIL below leaves none
  const zipFile = zipPathFor(pkgDir);
  const hadZip = existsSync(zipFile);
  rmSync(zipFile, { force: true });

  // 1 — the folder
  const a = auditPackage(pkgDir);
  const { files, ...auditRest } = a;
  const audit = { ...auditRest, fileCount: files.length, largest: [...files].sort((x, y) => y.bytes - x.bytes).slice(0, 5) };

  // 5 — the sample (chosen first: the route walk and the screenshots use it)
  const data = loadSliceData(pkgDir);
  const featuresById = new Map(data.estimates.map((q) => [q.id, estimateFeatures(q, data.rules)]));
  const featuresOf = (q: SliceQuote) => featuresById.get(q.id) ?? new Set<Feature>();
  const sample = sampleEstimates(data.estimates, featuresOf, SAMPLE_SIZE);
  const inSlice = FEATURES.filter((f) => data.estimates.some((q) => featuresOf(q).has(f)));
  const covered = FEATURES.filter((f) => sample.some((q) => featuresOf(q).has(f)));
  const missing = FEATURES.filter((f) => !covered.includes(f));
  const showcase = [...sample].sort((x, y) => featuresOf(y).size - featuresOf(x).size)[0] ?? null;

  // 2 — parity; 3 — every route (each step and tab on every sampled estimate, plus every shell screen)
  const parity = await parityCheck(pkgDir, []);
  const smokeR = await smoke(pkgDir, true, sample.map((q) => q.id));

  const sink = newSink();
  const unregistered = new Set<string>();
  const allowed = new Set(SMOKE_ALLOWED_UNREGISTERED);
  const note = async (page: Page) => (await unregisteredOn(page)).filter((x) => !allowed.has(x)).forEach((x) => unregistered.add(x));
  const screenshots: string[] = [];
  const rows: EstimateRow[] = [];
  const editCycle: Step[] = [];
  const shotDir = path.join(pkgDir, SCREENSHOT_DIR);
  mkdirSync(shotDir, { recursive: true });
  for (const f of readdirSync(shotDir)) if (f.endsWith(".png")) rmSync(path.join(shotDir, f), { force: true });
  const base = pathToFileURL(index).href;

  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new Error(launch.unavailable);
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: launch.executablePath, args: launch.args, headless: true, defaultViewport: { width: 1440, height: 900 } });
  try {
    const page = await newPage(browser, sink);

    // 4 — screenshots
    await openUrl(page, base);
    await page.waitForSelector("[data-handoff-list]", { timeout: 15_000 }).catch(() => sink.pageErrors.push("[verify] the Estimates list never appeared"));
    await settle(1200);
    await shot(page, shotDir, "01-estimates", screenshots);
    await note(page);
    if (showcase) {
      const steps: Array<[string, string]> = [["step=build", "02-build"], ["step=package", "03-build-package"], ["step=review", "04-customer-review"], ["step=send", "05-send-and-track"]];
      for (const [query, name] of steps) {
        await openUrl(page, estimateUrl(base, showcase.id, query));
        if (!(await waitMounted(page, sink))) sink.pageErrors.push(`[verify] ${showcase.id} ${query}: the Estimator never mounted`);
        await settle(800);
        await shot(page, shotDir, name, screenshots);
        await note(page);
      }
    }
    const screens: Array<[string, string, string]> = [["#/catalog", "[data-catalog-painted]", "06-catalog"], ["#/assemblies", "[data-handoff-assemblies]", "07-assemblies"], ["#/rules", "[data-handoff-rules]", "08-rules"]];
    for (const [hash, sel, name] of screens) {
      await openUrl(page, `${base}${hash}`);
      const ok = await page.waitForSelector(sel, { timeout: 15_000 }).then(() => true, () => false);
      if (!ok) sink.pageErrors.push(`[verify] ${hash}: ${sel} never appeared`);
      await settle(1000);
      await shot(page, shotDir, name, screenshots);
      await note(page);
    }

    // 5 — the sampled estimates' header totals
    for (const q of sample) {
      const errorsBefore = sink.pageErrors.length;
      await openUrl(page, estimateUrl(base, q.id));
      const mounted = await waitMounted(page, sink);
      const onScreen = await readHeaderTotal(page);
      const t = canonicalTotals(q, generalOf(data.rules));
      const expected = fmt(t.canonical);
      const number = displayQuoteNumber({ ...q, id: q.id });
      const numberShown = await pageHasText(page, number);
      const gFile = path.join(pkgDir, GOLDEN_DIR, goldenFileName(q.id));
      const goldenGrand = existsSync(gFile) ? ((JSON.parse(readFileSync(gFile, "utf8")) as { totals?: { grand?: number } }).totals?.grand ?? null) : null;
      const goldenOk = goldenGrand !== null && goldenGrand === t.raw;
      await note(page);
      rows.push({
        id: q.id, number, features: FEATURES.filter((f) => featuresOf(q).has(f)), onScreen, expected, goldenGrand, rawGrand: t.raw, goldenOk, numberShown,
        pass: mounted && numberShown && onScreen === expected && goldenOk && sink.pageErrors.length === errorsBefore,
      });
    }

    // 6 — edit → persist → Reset, in the UI
    const target = sample[0];
    if (target) {
      const url = estimateUrl(base, target.id);
      const step = (s: string, ok: boolean, detail?: string) => editCycle.push({ step: s, ok, ...(detail ? { detail } : {}) });
      await openUrl(page, url);
      step(`${target.id} mounted`, await waitMounted(page, sink));
      const qtyEl = await firstQtyInput(page);
      const qty0 = qtyEl ? Number(await qtyEl.evaluate((i) => i.value)) : NaN;
      const total0 = await readHeaderTotal(page);
      step("found the first line's quantity", !!qtyEl && Number.isFinite(qty0), String(qty0));
      if (qtyEl) {
        await qtyEl.click({ count: 3 });
        await qtyEl.type(String(qty0 + 1));
        await page.keyboard.press("Tab");
      }
      step("the header total moved with the quantity", await waitFor(async () => (await readHeaderTotal(page)) !== total0, 5000));
      await clickButton(page, "Save");
      step("Save shows Saved ✓", await waitFor(() => pageHasText(page, "Saved ✓"), 10_000));
      await note(page);
      await openUrl(page, url);
      await waitMounted(page, sink);
      const qtyAfter = await firstQtyInput(page);
      const qty1 = qtyAfter ? Number(await qtyAfter.evaluate((i) => i.value)) : NaN;
      step("after a reload the edited quantity persisted", qty1 === qty0 + 1, `${qty1} vs ${qty0 + 1}`);
      await page.click("[data-handoff-reset]");
      await waitFor(() => page.evaluate(() => !!document.querySelector("[data-handoff-reset-confirm]")), 3000);
      await Promise.all([page.waitForNavigation({ waitUntil: "load", timeout: 20_000 }), page.click("[data-handoff-reset-confirm]")]);
      step("Reset to production snapshot reloads the page", await waitMounted(page, sink));
      const qtyBack = await firstQtyInput(page);
      const qty2 = qtyBack ? Number(await qtyBack.evaluate((i) => i.value)) : NaN;
      step("…the quantity is the snapshot's again", qty2 === qty0, `${qty2} vs ${qty0}`);
      const total2 = await readHeaderTotal(page);
      step("…and the header total is the snapshot's", total2 === total0, `${total2} vs ${total0}`);
      await note(page);
    } else {
      editCycle.push({ step: "an estimate to edit", ok: false, detail: "the slice has none" });
    }
    await page.close();
  } finally {
    await browser.close();
  }

  const browserOk = sink.pageErrors.length === 0 && sink.foreignRequests.length === 0 && sink.failedLocal.length === 0 && unregistered.size === 0;
  const pass =
    a.ok && parity.pass && smokeR.pass && rows.length > 0 && rows.every((r) => r.pass) && editCycle.every((s) => s.ok) && browserOk &&
    screenshots.length === 8 && (opts.allowMissingFeatures || missing.length === 0);

  // 7 — the zip: written (with the screenshots) and read back on PASS only
  let zip: FullResult["zip"] = null;
  const zipRemoved = !pass && hadZip;
  if (pass) {
    const z = await writeZip(pkgDir, zipFile, zipDateOf(pkgDir));
    const back = await JSZip.loadAsync(readFileSync(zipFile));
    const names = Object.keys(back.files).filter((n) => !back.files[n].dir).sort();
    const order = Object.keys(back.files).filter((n) => !back.files[n].dir);
    zip = {
      file: path.relative(process.cwd(), zipFile), bytes: z.bytes, entries: names.length,
      allUnderRoot: order.every((n) => n.startsWith(`${ZIP_ROOT}/`)),
      confidentialFirst: order[0] === zipName("CONFIDENTIAL.txt"),
      matchesFolder: order.join("\n") === zipEntries(pkgDir).map(zipName).join("\n"),
      screenshots: names.filter((n) => n.startsWith(zipName(`${SCREENSHOT_DIR}/`))).length,
    };
  }
  const zipOk = !pass || (!!zip && zip.allUnderRoot && zip.confidentialFirst && zip.matchesFolder && zip.screenshots === screenshots.length);

  return {
    pass: pass && zipOk,
    audit, parity, smoke: smokeR, sample: rows, sliceSize: data.estimates.length,
    features: { covered, missing, inSlice, allowMissing: opts.allowMissingFeatures },
    editCycle, screenshots, unregistered: [...unregistered], zip, zipRemoved, ...sink,
  };
}

export function printFull(r: FullResult): void {
  console.log("");
  printParity(r.parity);
  console.log("");
  printSmoke(r.smoke);
  console.log("");
  console.log(`handoff:verify --full  ${r.pass ? "PASS" : "FAIL"}`);
  const a = r.audit;
  console.log(`  package: ${a.fileCount} files, ${(a.totalBytes / 1e6).toFixed(2)} MB (≤ 150 MB: ${a.totalOver ? "NO" : "yes"}); over 15,000,000 bytes: ${a.oversize.length}; "part-docs/": ${a.privatePaths.length}; missing: ${a.missing.length}${a.junk.length ? `; junk never zipped: ${a.junk.join(", ")}` : ""}`);
  for (const f of [...a.oversize, ...a.privatePaths, ...a.missing]) console.log(`    ${f}`);
  console.log(`  largest: ${a.largest.map((f) => `${f.file} ${f.bytes}`).join(" · ")}`);
  console.log(`  sample: ${r.sample.length} of ${r.sliceSize} estimate(s)`);
  for (const s of r.sample) {
    console.log(`    ${s.pass ? "ok  " : "FAIL"} ${s.id} (${s.number}${s.numberShown ? "" : " NOT SHOWN"}): header ${s.onScreen ?? "—"} · expected ${s.expected} · golden grand ${s.goldenGrand === null ? "—" : fmt(s.goldenGrand)}${s.goldenOk ? "" : ` ≠ totals() ${fmt(s.rawGrand)}`}${s.features.length ? ` · ${s.features.join(", ")}` : ""}`);
  }
  console.log(`  features covered: ${r.features.covered.join(", ") || "none"}; not covered: ${r.features.missing.join(", ") || "none"}${r.features.missing.length ? (r.features.allowMissing ? " (--allow-missing-features: reported only)" : " — FAIL (every feature must be covered; --allow-missing-features for a dev slice)") : ""}`);
  for (const f of r.features.missing) console.log(`    not covered: ${FEATURE_LABEL[f]}${r.features.inSlice.includes(f) ? "" : " — none in the slice"}`);
  console.log("  edit → persist → Reset:");
  for (const s of r.editCycle) console.log(`    ${s.ok ? "ok  " : "FAIL"} ${s.step}${s.detail ? ` (${s.detail})` : ""}`);
  console.log(`  screenshots (${r.screenshots.length}, spec/screenshots/): ${r.screenshots.join(", ")}`);
  console.log(`  page errors: ${r.pageErrors.length}; foreign requests: ${r.foreignRequests.length}; failed local files: ${r.failedLocal.length}; unregistered calls: ${r.unregistered.length}`);
  for (const e of r.pageErrors) console.log(`    ${e.split("\n").slice(0, 4).join("\n    ")}`);
  for (const u of [...r.foreignRequests, ...r.failedLocal, ...r.unregistered]) console.log(`    ${u}`);
  if (r.zip) console.log(`  zip: ${r.zip.file} ${r.zip.bytes} bytes (${(r.zip.bytes / 1e6).toFixed(2)} MB), ${r.zip.entries} entries; all under ${ZIP_ROOT}/: ${r.zip.allUnderRoot ? "yes" : "NO"}; CONFIDENTIAL.txt first: ${r.zip.confidentialFirst ? "yes" : "NO"}; matches the folder: ${r.zip.matchesFolder ? "yes" : "NO"}; screenshots: ${r.zip.screenshots}`);
  else console.log(`  zip: not written (the package did not pass)${r.zipRemoved ? "; the earlier zip was removed" : ""}`);
  console.log(`  result: ${path.relative(process.cwd(), path.join(VERIFY_DIR, "full.json"))}`);
}

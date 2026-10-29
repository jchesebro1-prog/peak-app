/**
 * handoff:verify — headless-Chrome checks of the built prototype, opened from file://.
 *
 *   npm run handoff:verify -- --smoke [--out <package dir>]
 *
 * --smoke  opens index.html (the shell's Estimates list at #/estimates), then the default estimate at
 *          index.html?id=Q-G001#/estimate/Q-G001, waits for [data-handoff-ready] and the Estimator root, lets
 *          mount-time effects settle, then fails on: any pageerror; any console.error not on
 *          BENIGN_CONSOLE_ERRORS (every mode: newPage counts them as page errors); any request that is not
 *          local (file:, data:, blob:, about:) or Google Fonts; any local file that failed to
 *          load; any unregistered server action outside SMOKE_ALLOWED_UNREGISTERED (a page with no
 *          unregistered-call hook fails too); the app's fonts not computed on the list (readFonts).
 *          Screenshot: output/verify/smoke-build.png; result: output/verify/smoke.json.
 *          --all-steps (Task 6): also walks every slice estimate through Build, the three Build package tabs,
 *          each Customer review tab and Send & track, then the Catalog, the Assembly Builder, a rack's sheets
 *          (SHELL_SCREENS, Task 9) and Estimating Rules with its sub-pages (Task 10), collecting mount-time calls from
 *          all of them; and fails
 *          on any discovered "use server" export (output/handoff-build/discovered-actions.json) that the page
 *          has no registration for. SMOKE_ALLOWED_UNREGISTERED is empty.
 *
 *   npm run handoff:verify -- --estimator <quoteId|all> [--out <package dir>]
 *
 * --estimator  opens index.html?id=<quoteId>#/estimate/<quoteId> (each slice estimate for `all`) and compares the
 *          header's "Quoted total" with the total the Estimator must show: the quote's sections
 *          after the canonicalization it applies on load (system order, then the hidden 5 % / 2 %
 *          bonus lines for an eligible draft — expectedEstimatorTotals). The raw golden
 *          (core:golden, .data-handoff/golden or docs/estimating-core/golden) is reported beside
 *          it. Fails on a mismatch, a pageerror, a foreign request or an unexpected unregistered
 *          action. Then, on the first estimate, the IndexedDB overlay: persistent, a quote edit
 *          survives a reload and shows in the header, a tombstone survives a reload, and Reset
 *          brings the snapshot back. Result: output/verify/estimator.json.
 *
 *   npm run handoff:verify -- --estimator-edit [quoteId] [--out <package dir>]
 *
 * --estimator-edit  the Build step's real work (Task 4): a qty edit, a catalog add and a brand-new
 *          estimate (`?new=1`) each Save, survive a reload, and the new one gets the next EST number.
 *          Result: output/verify/estimator-edit.json.
 *
 *   npm run handoff:verify -- --review [quoteId] [--out <package dir>]
 *
 * --review  the customer-facing views render live from the store (Task 5): Build package → BOM quote
 *          shows the letterhead and the expected grand total; Customer review's Document, Package
 *          page and BOM tabs each render content with no /estimator-preview frame; a review comment
 *          survives a reload; Print → PDF (print media) shows the document only, the chrome hidden,
 *          with the confidential footer. Then (Q-G002): the package page's Narrative / BOM toggle switches
 *          in place with no overlay; the ⧉ pop-out shows its notice and opens no window; More ▾ → Cut
 *          sheets opens the overlay (Esc / ✕ close it, and the window.open("", "_blank") stand-in
 *          navigates through location.replace); an injected curtain line shows its Client cut sheet on
 *          the Cut sheets tab and, with "Cut sheets" on the PDF, prints after the document. The store is reset after.
 *          Screenshots: output/verify/review-*.png; result: output/verify/review.json.
 *
 *   npm run handoff:verify -- --send [quoteId] [--out <package dir>]
 *
 * --send  Send & track, simulated (Task 6), on the default estimate Q-G001 (or the given id): a verify-only Estimator persona
 *          (VERIFY_ESTIMATOR, appended to the roster before the page loads) Submits for approval; a Manager
 *          from the roster (switched through localStorage, ports CURRENT_USER_KEY) Approves only; the composer
 *          is pre-filled; Send & mark sent → Sent, the Activity card reads "Sent (simulated)", a reload keeps
 *          both; Mark Won → the prototype log shows "Would create install project". 0 foreign requests: nothing
 *          leaves the browser. The store is reset after. Screenshots: output/verify/send-*.png; result: send.json.
 *
 *   npm run handoff:verify -- --shell [--out <package dir>]
 *
 * --shell  the app shell (Task 7): a bare index.html is the Estimates list (N rows = the slice's system estimates; every
 *          row's total is the Estimator's grand total for it — the first row's also checked against the Estimator's
 *          header after opening it); opening a row lands on Build (#/estimate/<id>, ?id= in the search) and the browser
 *          Back button returns to the list; the nav; router.push / link-click mapping of app paths (/estimator?id=,
 *          /quotes, /catalog, /design/assemblies, /estimating-rules, /design/grid/… → the notice); the user switcher
 *          (a Reviewer-only persona hides "New estimate", the pick survives a reload); a new estimate keeps its screen
 *          through the first save's id, and Back into its pre-save entries reopens the SAVED estimate; one history
 *          entry per in-app link (Narrative → "Change in Client package →", the Build card's "Customer: … ↗") with
 *          Back / Forward between steps and tabs never remounting, and #systems scrolled to; a target="_blank" app
 *          path (Cover PDF Download) shows the notice and opens no page; a host's own query param survives
 *          navigation; Reset restores an edited quantity (Cancel changes nothing; focus starts on Reset, Tab stays in
 *          the dialog, Escape closes it and focus returns; a Reset blocked by another window says "Close other
 *          prototype windows and try again." in the dialog); no IndexedDB → the not-persistent notice. The walk lives
 *          in verify/shell.ts. Screenshots: output/verify/shell-*.png; result: output/verify/shell.json.
 *
 *   npm run handoff:verify -- --catalog [--out <package dir>]
 *
 * --catalog  the Catalog screen (Task 8): #/catalog paints its first page within 2 s over the whole slice (the time is logged) and
 *          never holds more than 100 rows; the Category / Manufacturer facets count what they filter (crossed); the search
 *          lists the Estimator picker's own ranking; a known SKU is the first result; editing a part's list price saves to
 *          the overlay and survives a reload; the Estimator then adds the part at that price — a part with no cost sells at
 *          its LIST price, a part with a cost at cost × (1 + markup) (catalogAddPrice) and its list does not move the line;
 *          a new part's SKU must be unique; a Reviewer-only role can look but not edit; Reset restores the snapshot. The walk
 *          lives in verify/catalog.ts. Screenshots: output/verify/catalog-*.png; result: output/verify/catalog.json.
 *
 *   npm run handoff:verify -- --assemblies [--out <package dir>]
 *
 * --assemblies  the Assembly Builder (Task 9): #/assemblies runs the app's real FixtureBuilder and lists the slice's
 *          fixtures (each at its live sell); a fixture built from two catalog parts saves to the overlay; the Estimator's
 *          "+ Add assembly" lists it and the line it adds prices at the fixture's sell; a rack with a device placed on its
 *          elevation saves and its Submittal link opens #/assemblies/rack/<id> with the elevation SVG; delete soft-deletes;
 *          Reset restores. The walk lives in verify/assemblies.ts. Screenshots: output/verify/assemblies-*.png; result:
 *          output/verify/assemblies.json.
 *
 *   npm run handoff:verify -- --rules [--out <package dir>]
 *
 * --rules  Estimating Rules (Task 10): #/rules runs the app's real editors; a Gold markup edit saves to the store and the
 *          next new Gold estimate adds a catalog part at the new markup; a track series' stick length edit shows in the
 *          Estimator's track configurator; Curtain mounts / System categories mount (a category save writes the store); the
 *          venue doctrine saves; Conduit sizes is the notice; a non-admin is locked out; the editor's Reset and Reset to
 *          production snapshot restore the markup and the stick. The walk lives in verify/rules.ts. Screenshots:
 *          output/verify/rules-*.png; result: output/verify/rules.json.
 *
 *   npm run handoff:verify -- --photos [--out <package dir>]
 *
 * --photos  packaged product photos (Task 11), on a scratch COPY of the package (output/verify/photos-pkg): the harness writes
 *          two tiny images + images/manifest.json + the data/photos.js handoff:slice would emit, then checks, from file://,
 *          that the Catalog thumbnail of a part with a photo and the quote document's key-product photo both load that
 *          images/ file (file: request, naturalWidth > 0), and that a part with no photo, and one whose file is missing,
 *          show the "Image coming soon" placeholder. The walk lives in verify/photos.ts. Screenshots: output/verify/photos-*.png;
 *          result: output/verify/photos.json.
 *
 *   npm run handoff:verify -- --drift [--update [<port> …]]
 *
 * --drift  the ported server logic's originals (port-sources.json, port-drift.ts): recomputes each
 *          original's sha256 and fails, listing every port whose original changed since it was ported
 *          ("re-check <port> against <original>…"). `--update <port> …` stamps the current hashes of the named
 *          ports only (repo-relative paths, as port-sources.json lists them; an unknown name fails and writes
 *          nothing) after re-checking them; a bare `--update` re-stamps every entry. No browser. Not part of
 *          test:specs (app-side edits must not fail it).
 *
 *   npm run handoff:verify -- --serve [--out <package dir>]
 *
 * --serve  the Artifact path: the package's shipped files (the zip's entries — never junk or images/manifest.json)
 *          served over http on 127.0.0.1 and a free port, opened as index.html?v=1 (a host adds a query string), then
 *          --smoke --all-steps over every estimate plus the fonts check (Public Sans / IBM Plex Mono computed, also with
 *          <html>'s attributes stripped, as a host that rewrites <html> would). Result: output/verify/serve.json.
 *
 *   npm run handoff:verify -- --parity [--export <export.json> …] [--out <package dir>]
 *
 * --parity  the readable engine (Task 12): app/estimating-core.js, loaded in Node (vm and require()), has the source
 *          index.ts's exact export surface and reproduces every spec/golden/<id>.json byte for byte (goldenWith over
 *          data/estimates.js); with --export (repeatable), core:golden over that export reproduces them too. No browser.
 *          The walk lives in verify/parity.ts. Result: output/verify/parity.json.
 *
 *   npm run handoff:verify -- --full [--allow-missing-features] [--out <package dir>]
 *
 * --full  the whole package (Task 12): the folder audit (≤ 15,000,000 bytes a file, ≤ 150 MB, no "part-docs/<id>/…", nothing
 *          missing), --parity, --smoke --all-steps over the sampled estimates, 1440×900 screenshots into the package's spec/screenshots/, a sample
 *          of 20 estimates (seeded; one per feature first — alternate, rack, curtain + track, bonus) whose header totals
 *          must equal the Estimator's post-load totals, the edit → persist → Reset cycle, 0 page errors / foreign requests
 *          / unregistered calls. Feature coverage is strict: a feature the sample doesn't cover fails the run
 *          (--allow-missing-features, for dev runs on a slice that lacks one, only reports it). The zip is deleted at
 *          the start and written (every entry under peak-estimator-handoff/) and read back on PASS only. The walk lives in
 *          verify/full.ts. Result: output/verify/full.json.
 *
 * Plan: PR 2 Tasks 2–12.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import * as vm from "node:vm";
import { pathToFileURL } from "node:url";
import type { Browser, Page } from "puppeteer-core";
import { chromeLaunch } from "@/lib/quote-pdf/render";
import { fmt, totals } from "@/lib/estimating-core/pricing";
import type { SpecSection } from "@/lib/estimating-core/types";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { PREVIEW_COPY } from "@/lib/estimate-output/package-preview";
import { POPOUT_NOTICE, PRINT_FOOTER_TEXT } from "./ui/preview-routes";
import { CURRENT_USER_KEY } from "./runtime/ports";
import { canonicalTotals } from "./runtime/estimate-totals";
import { driftClean, driftMessages, driftOf, parsePortSources, PORT_SCAN_DIR, PORT_SOURCES_FILE, sha256Of, unknownPorts, unlistedPorts, updatedPortSources } from "./port-drift";

export const ROOT = path.resolve(__dirname, "..", "..");
export const VERIFY_DIR = path.join(ROOT, "output", "verify");

/** Mount-time actions allowed to be unregistered. Empty since Task 6: every server action the bundle stubs is
 *  registered — implemented, shape-valid empty or an explicit refusal (runtime/actions/misc-refusals.ts) — and
 *  `--smoke --all-steps` fails on any discovered export without a registration. */
export const SMOKE_ALLOWED_UNREGISTERED: readonly string[] = [];

const LOCAL_SCHEMES = new Set(["file:", "data:", "blob:", "about:"]);
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

/** The --serve run's own origin (http://127.0.0.1:<port>): requests to it are the package's own files. Set by serveCheck. */
let servedOrigin: string | null = null;

/** "local" | "fonts" | "foreign" for one request URL (the --serve origin counts as local). */
export function classifyRequest(url: string, localOrigin: string | null = servedOrigin): "local" | "fonts" | "foreign" {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "foreign";
  }
  if (LOCAL_SCHEMES.has(u.protocol)) return "local";
  if (localOrigin && u.origin === localOrigin) return "local";
  if (u.protocol === "https:" && FONT_HOSTS.has(u.hostname)) return "fonts";
  return "foreign";
}

/**
 * console.error output a run may see without failing — each one benign, with why. Everything else a page logs with
 * console.error fails the run (it lands in pageErrors as "[console.error] …"), like an uncaught error does.
 */
export const BENIGN_CONSOLE_ERRORS: ReadonlyArray<{ test: (text: string, url: string) => boolean; why: string }> = [
  // index.html's Google Fonts stylesheet is optional: offline (or a blocked network) Chrome logs the failed request,
  // and the UI falls back to the family names. The URL is the console message's location, not its text.
  { test: (text, url) => /^Failed to load resource\b/.test(text) && classifyRequest(url, null) === "fonts", why: "optional web fonts unreachable" },
  // Served over http (--serve, an Artifact, any web host), the browser asks the host for /favicon.ico on its own; the
  // package ships none, so a host without one answers 404. Not a package file, never requested by the page.
  { test: (text, url) => /^Failed to load resource\b/.test(text) && /^https?:\/\/[^/]+\/favicon\.ico$/.test(url), why: "the host's /favicon.ico (the package has none)" },
];

/** True when a console.error is on the BENIGN_CONSOLE_ERRORS list. Pure. */
export function isBenignConsoleError(text: string, url = ""): boolean {
  return BENIGN_CONSOLE_ERRORS.some((b) => b.test(text, url));
}

/** The text a non-benign console.error adds to a run's page errors (with the resource URL when the message has one). */
export const consoleErrorEntry = (text: string, url = "") => `[console.error] ${text}${url && !text.includes(url) ? ` (${url})` : ""}`;

/** The unregistered-call hook's entry when a page has none: the check could not run, so it fails. */
export const NO_UNREGISTERED_HOOK = "(no __peakHandoff.calledUnregistered hook — the unregistered-call check could not run)";

/** The Public Sans / IBM Plex Mono fonts the app's CSS asks for, as computed on a page (pure on the strings). */
export function fontsOk(f: { ui: string; mono: string }): boolean {
  return /Public Sans/.test(f.ui) && /IBM Plex Mono/.test(f.mono);
}

/**
 * The computed fonts of a mounted page — `body` (var(--font-ui)) and a probe element in var(--font-mono) — read twice:
 * as served, and after every attribute of <html> is removed (what a host that rewrites <html> does). The variables
 * live in index.html's :root rule, so both reads must name the app's fonts.
 */
export async function readFonts(page: Page): Promise<{ ui: string; mono: string; uiBare: string; monoBare: string }> {
  // A string, not a function: tsx wraps named inner functions in a `__name` helper the page doesn't have.
  return page.evaluate(`(() => {
    const read = () => {
      const probe = document.createElement("span");
      probe.style.fontFamily = "var(--font-mono)";
      document.body.appendChild(probe);
      const out = { ui: getComputedStyle(document.body).fontFamily, mono: getComputedStyle(probe).fontFamily };
      probe.remove();
      return out;
    };
    const first = read();
    const html = document.documentElement;
    const saved = [...html.attributes].map((a) => [a.name, a.value]);
    for (const [n] of saved) html.removeAttribute(n);
    const bare = read();
    for (const [n, v] of saved) html.setAttribute(n, v);
    return { ui: first.ui, mono: first.mono, uiBare: bare.ui, monoBare: bare.mono };
  })()`) as Promise<{ ui: string; mono: string; uiBare: string; monoBare: string }>;
}

export type SmokeResult = {
  pass: boolean;
  url: string;
  /** --all-steps: every view walked (estimate · step · tab) — mount-time calls of all four steps count. */
  walked: string[];
  /** --all-steps: discovered "use server" exports (output/handoff-build/discovered-actions.json) with no registration at all. */
  notRegistered: string[];
  readyMs: number | null;
  /** The bare index.html opened on the shell's Estimates list. */
  listMounted: boolean;
  estimatorMounted: boolean;
  pageErrors: string[];
  foreignRequests: string[];
  failedLocal: string[];
  fontRequests: number;
  unregistered: string[];
  unexpectedUnregistered: string[];
  consoleErrors: string[];
  /** The computed fonts on the Estimates list (readFonts) and whether they are the app's, also with <html> stripped. */
  fonts: { ui: string; mono: string; uiBare: string; monoBare: string } | null;
  fontsOk: boolean;
  screenshot: string;
};

/** The views --smoke --all-steps opens on each slice estimate: Build, the three Build package tabs, each Customer review tab, Send & track. */
export const ALL_STEP_VIEWS: ReadonlyArray<{ query: string; tabs?: readonly string[] }> = [
  { query: "step=build" },
  { query: "step=package&ptab=narrative" },
  { query: "step=package&ptab=bom" },
  { query: "step=package&ptab=client" },
  { query: "step=review", tabs: ["Document", "Package page", "BOM", "Cut sheets", "Datasheets", "Drawings"] },
  { query: "step=send" },
];

/**
 * The views --smoke --all-steps opens on a Box goods sale (#362): the client gets the BOM only, so Build package is the BOM
 * quote tab alone (any other `?ptab=` lands there) and Customer review offers Document + BOM. Walking the full list on one
 * would fail on a tab the app deliberately hides.
 */
export const BOX_SALE_STEP_VIEWS: ReadonlyArray<{ query: string; tabs?: readonly string[] }> = [
  { query: "step=build" },
  { query: "step=package&ptab=bom" },
  { query: "step=review", tabs: ["Document", "BOM"] },
  { query: "step=send" },
];

/** The views to walk for an estimate: a box sale's own list, else every step and tab. */
export function stepViewsFor(boxSale: boolean): ReadonlyArray<{ query: string; tabs?: readonly string[] }> {
  return boxSale ? BOX_SALE_STEP_VIEWS : ALL_STEP_VIEWS;
}

/** The shell screens --smoke --all-steps also opens (hash → the element that says it rendered): the Catalog, the Assembly Builder, a rack's sheets (an unknown id → its not-found screen). */
export const SHELL_SCREENS: ReadonlyArray<readonly [string, string]> = [
  ["#/catalog", "[data-catalog-painted]"],
  ["#/assemblies", "[data-handoff-assemblies]"],
  ["#/assemblies/rack/SA-NONE", "[data-handoff-missing]"],
  // Task 10: Estimating Rules and its three sub-pages.
  ["#/rules", "[data-handoff-rules]"],
  ["#/rules/track-series", '[data-handoff-rules-page="track-series"]'],
  ["#/rules/curtain-mounts", '[data-handoff-rules-page="curtain-mounts"]'],
  ["#/rules/system-categories", '[data-handoff-rules-page="system-categories"]'],
];

/** "fileKey#name" of every discovered server-action export the page has no registration for. Pure. */
export function unregisteredExports(discovered: Record<string, string[]>, registered: readonly string[]): string[] {
  const have = new Set(registered);
  return Object.entries(discovered).flatMap(([file, names]) => names.map((n) => `${file}#${n}`)).filter((id) => !have.has(id));
}

/** `onlyIds` (--full): walk --all-steps over these estimates instead of every slice estimate (a production slice can hold hundreds). */
export async function smoke(pkgDir: string, allSteps = false, onlyIds?: readonly string[], opts: { baseUrl?: string } = {}): Promise<SmokeResult> {
  const index = path.join(pkgDir, "index.html");
  if (!existsSync(index)) throw new Error(`${index} not found — run npm run handoff:build first`);
  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new Error(launch.unavailable);
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: launch.executablePath, args: launch.args, headless: true, defaultViewport: { width: 1440, height: 900 } });
  // file:// by default; --serve passes the package's http URL (with a host-style query string)
  const url = opts.baseUrl ?? pathToFileURL(index).href;
  const pageErrors: string[] = [];
  const foreignRequests: string[] = [];
  const failedLocal: string[] = [];
  const consoleErrors: string[] = [];
  let fontRequests = 0;
  mkdirSync(VERIFY_DIR, { recursive: true });
  const screenshot = path.join(VERIFY_DIR, "smoke-build.png");
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => pageErrors.push(e instanceof Error ? e.stack || e.message : String(e)));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      consoleErrors.push(m.text());
      if (!isBenignConsoleError(m.text(), m.location()?.url ?? "")) pageErrors.push(consoleErrorEntry(m.text(), m.location()?.url ?? ""));
    });
    page.on("request", (r) => {
      const kind = classifyRequest(r.url());
      if (kind === "foreign") foreignRequests.push(r.url());
      else if (kind === "fonts") fontRequests++;
    });
    page.on("requestfailed", (r) => {
      if (classifyRequest(r.url()) === "local") failedLocal.push(`${r.url()} (${r.failure()?.errorText ?? "failed"})`);
    });
    const t0 = Date.now();
    await openUrl(page, url);
    let readyMs: number | null = null;
    try {
      await page.waitForSelector("[data-handoff-ready]", { timeout: 15_000 });
      readyMs = Date.now() - t0;
    } catch {
      pageErrors.push("[verify] [data-handoff-ready] never appeared within 15 s");
    }
    // Mount-time effects (server-action calls) run after the first render; let them settle.
    await new Promise((r) => setTimeout(r, 1500));
    // A bare index.html is the shell's Estimates list (#/estimates)…
    const listMounted = await page.evaluate(() => !!document.querySelector("[data-handoff-list]") && location.hash === "#/estimates");
    // the app's fonts, as served and with <html> stripped (index.html's :root rule)
    const fonts = await readFonts(page).catch(() => null);
    const fontsPass = !!fonts && fontsOk(fonts) && fontsOk({ ui: fonts.uiBare, mono: fonts.monoBare });
    await page.screenshot({ path: path.join(VERIFY_DIR, "smoke-list.png") as `${string}.png` });
    // …and the Estimator is one estimate away: the default one (Q-G001), else the first in the slice.
    const sliceIds = loadSliceData(pkgDir).estimates.map((q) => q.id);
    await openUrl(page, estimateUrl(url, sliceIds.includes("Q-G001") ? "Q-G001" : (sliceIds[0] ?? "Q-G001")));
    try {
      await page.waitForSelector("[data-handoff-ready]", { timeout: 15_000 });
    } catch {
      pageErrors.push("[verify] the default estimate: [data-handoff-ready] never appeared within 15 s");
    }
    await new Promise((r) => setTimeout(r, 1500));
    let estimatorMounted = await page.evaluate(() => !!document.querySelector(".est-root"));
    await page.screenshot({ path: screenshot as `${string}.png` });
    const readUnregistered = () => unregisteredOn(page);
    const seen = new Set<string>(await readUnregistered());
    const walked: string[] = [];
    let notRegistered: string[] = [];
    if (allSteps) {
      // Every slice estimate × every step (and every tab that mounts its own components).
      const sliceEstimates = loadSliceData(pkgDir).estimates;
      const ids = onlyIds ? [...onlyIds] : sliceEstimates.map((q) => q.id);
      const boxIds = new Set(sliceEstimates.filter((q) => q.boxSale === true).map((q) => q.id));
      for (const id of ids) {
        for (const v of stepViewsFor(boxIds.has(id))) {
          await openUrl(page, estimateUrl(url, id, v.query));
          try {
            await page.waitForSelector("[data-handoff-ready]", { timeout: 15_000 });
          } catch {
            pageErrors.push(`[verify] ${id} ${v.query}: [data-handoff-ready] never appeared within 15 s`);
            continue;
          }
          await new Promise((r) => setTimeout(r, 1200));
          estimatorMounted &&= await page.evaluate(() => !!document.querySelector(".est-root"));
          walked.push(`${id} ${v.query}`);
          for (const tab of v.tabs ?? []) {
            const clicked = await page.evaluate((t) => {
              const b = [...document.querySelectorAll('[role="tab"]')].find((x) => x.textContent?.trim() === t && (x as HTMLElement).offsetParent !== null) as HTMLElement | undefined;
              b?.click();
              return !!b;
            }, tab);
            if (!clicked) {
              pageErrors.push(`[verify] ${id} ${v.query}: no "${tab}" tab`);
              continue;
            }
            await new Promise((r) => setTimeout(r, 800));
            walked.push(`${id} ${v.query} → ${tab}`);
          }
          for (const x of await readUnregistered()) seen.add(x);
        }
      }
      // The shell's other app screens: their mount-time actions count too (Task 9: the Assembly Builder and a rack's sheets).
      for (const [hash, sel] of SHELL_SCREENS) {
        await openUrl(page, `${url}${hash}`);
        const ok = await page.waitForSelector(sel, { timeout: 15_000 }).then(
          () => true,
          () => false,
        );
        if (!ok) {
          pageErrors.push(`[verify] ${hash}: ${sel} never appeared within 15 s`);
          continue;
        }
        await new Promise((r) => setTimeout(r, 1200));
        walked.push(hash);
        for (const x of await readUnregistered()) seen.add(x);
      }
      // Structural: every "use server" export the bundle stubs has a registration (implemented or refused).
      const discoveredFile = path.join(ROOT, "output", "handoff-build", "discovered-actions.json");
      const discovered = existsSync(discoveredFile) ? (JSON.parse(readFileSync(discoveredFile, "utf8")) as Record<string, string[]>) : {};
      const registered = await page.evaluate(() => (window as unknown as { __peakHandoff?: { registeredActions?: () => string[] } }).__peakHandoff?.registeredActions?.() ?? []);
      notRegistered = Object.keys(discovered).length ? unregisteredExports(discovered, registered) : ["(output/handoff-build/discovered-actions.json missing — run npm run handoff:build)"];
    }
    const unregistered = [...seen];
    const allowed = new Set(SMOKE_ALLOWED_UNREGISTERED);
    const unexpectedUnregistered = unregistered.filter((id) => !allowed.has(id));
    const pass = pageErrors.length === 0 && foreignRequests.length === 0 && failedLocal.length === 0 && unexpectedUnregistered.length === 0 && notRegistered.length === 0 && listMounted && estimatorMounted && fontsPass;
    return { pass, url, walked, notRegistered, readyMs, listMounted, estimatorMounted, pageErrors, foreignRequests, failedLocal, fontRequests, unregistered, unexpectedUnregistered, consoleErrors, fonts, fontsOk: fontsPass, screenshot };
  } finally {
    await browser.close();
  }
}

export function printSmoke(r: SmokeResult): void {
  console.log(`handoff:verify --smoke  ${r.pass ? "PASS" : "FAIL"}`);
  console.log(`  ${r.url}`);
  console.log(`  ready after ${r.readyMs ?? "—"} ms; Estimates list at #/estimates: ${r.listMounted ? "yes" : "NO"}; Estimator mounted: ${r.estimatorMounted ? "yes" : "NO"}`);
  console.log(`  page errors: ${r.pageErrors.length}`);
  for (const e of r.pageErrors) console.log(`    ${e.split("\n").slice(0, 4).join("\n    ")}`);
  console.log(`  foreign requests: ${r.foreignRequests.length}${r.foreignRequests.length ? "" : ` (Google Fonts requests: ${r.fontRequests})`}`);
  for (const u of r.foreignRequests) console.log(`    ${u}`);
  console.log(`  failed local files: ${r.failedLocal.length}`);
  for (const u of r.failedLocal) console.log(`    ${u}`);
  if (r.walked.length) console.log(`  --all-steps: walked ${r.walked.length} views; discovered exports with no registration: ${r.notRegistered.length}`);
  for (const id of r.notRegistered) console.log(`    NOT REGISTERED ${id}`);
  console.log(`  unregistered server actions called: ${r.unregistered.length} (unexpected: ${r.unexpectedUnregistered.length})`);
  for (const id of r.unregistered) console.log(`    ${r.unexpectedUnregistered.includes(id) ? "UNEXPECTED " : "allowed    "}${id}`);
  const benign = Math.max(0, r.consoleErrors.length - r.pageErrors.filter((e) => e.startsWith("[console.error] ")).length);
  console.log(`  console errors: ${r.consoleErrors.length} (benign, allowed: ${benign}; the rest are page errors above)`);
  for (const e of r.consoleErrors.slice(0, 10)) console.log(`    ${e.slice(0, 200)}`);
  console.log(`  fonts: ${r.fontsOk ? "ok" : "NOT the app's"} — body ${r.fonts?.ui ?? "—"} · mono ${r.fonts?.mono ?? "—"}; with <html> stripped: ${r.fonts?.uiBare ?? "—"} · ${r.fonts?.monoBare ?? "—"}`);
  console.log(`  screenshot: ${path.relative(ROOT, r.screenshot)}`);
}

/* ------------------------------------------------------------------ --estimator */

export type SliceQuote = { id: string; boxSale?: boolean | null; status?: string | null; source?: string | null; quoteType?: string | null; estNo?: number | null; estSuffix?: number | null; spec?: { sections?: unknown; groups?: unknown }; updatedAt?: number | null; createdAt?: number | null };
type SliceData = { estimates: SliceQuote[]; rules: { settings?: Record<string, unknown>; blobs?: Record<string, unknown> } };

/** The slice's estimates.js + rules.js, run in a sandbox (the page loads them the same way). */
export function loadSliceData(pkgDir: string): SliceData {
  const window: Record<string, unknown> = {};
  const ctx = vm.createContext({ window });
  for (const f of ["rules.js", "estimates.js"]) {
    const file = path.join(pkgDir, "data", f);
    if (existsSync(file)) vm.runInContext(readFileSync(file, "utf8"), ctx, { filename: file });
  }
  return {
    estimates: Array.isArray(window.PEAK_ESTIMATES) ? (window.PEAK_ESTIMATES as SliceQuote[]) : [],
    rules: (window.PEAK_RULES as SliceData["rules"]) ?? {},
  };
}

/**
 * What the Estimator's header must read for a stored quote: `raw` = totals() of the stored
 * sections (the golden); `canonical` = totals() after the canonicalization the Estimator applies
 * on load — page.tsx normalizeSystemOrder; use-estimator-state's initial state (#267: a draft,
 * non-portal estimate's systems round up to the next $25 — withPriceRound); then its bonus effect
 * (bonusRulesApply → withBonusLines at bonusRatesFor(status, …, Estimating Rules' rates)).
 */
export function expectedEstimatorTotals(q: SliceQuote, rules: SliceData["rules"]): { raw: number; canonical: number; priceRound: boolean; bonusLines: boolean } {
  return canonicalTotals(q, ((rules.blobs ?? {}).pricing_rules ?? {}) as Record<string, unknown>);
}

export function goldenGrand(id: string): { grand: number; file: string } | null {
  for (const dir of [".data-handoff/golden", "docs/estimating-core/golden"]) {
    const file = path.join(ROOT, dir, `${id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
    if (existsSync(file)) {
      const g = JSON.parse(readFileSync(file, "utf8")) as { totals?: { grand?: number } };
      if (typeof g.totals?.grand === "number") return { grand: g.totals.grand, file: path.relative(ROOT, file) };
    }
  }
  return null;
}

/**
 * page.goto that always LOADS the page. A goto to the URL the page already shows (or one that differs only in its #hash,
 * the shell's route) is a same-document navigation — no reload, so a persona switch or a store edit would never be re-read.
 */
export async function openUrl(page: Page, url: string): Promise<void> {
  const bare = (u: string) => u.split("#")[0];
  if (bare(page.url()) === bare(url)) await page.goto("about:blank");
  await page.goto(url, { waitUntil: "load" });
}

export type PageSink = { pageErrors: string[]; foreignRequests: string[]; failedLocal: string[]; consoleErrors: string[] };

export function newSink(): PageSink {
  return { pageErrors: [], foreignRequests: [], failedLocal: [], consoleErrors: [] };
}

export async function newPage(browser: Browser, sink: PageSink): Promise<Page> {
  const page = await browser.newPage();
  page.on("pageerror", (e) => sink.pageErrors.push(e instanceof Error ? e.stack || e.message : String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    sink.consoleErrors.push(m.text());
    // a console.error fails the run like an uncaught error does, unless it is on the benign list
    if (!isBenignConsoleError(m.text(), m.location()?.url ?? "")) sink.pageErrors.push(consoleErrorEntry(m.text(), m.location()?.url ?? ""));
  });
  page.on("request", (r) => {
    if (classifyRequest(r.url()) === "foreign") sink.foreignRequests.push(r.url());
  });
  page.on("requestfailed", (r) => {
    if (classifyRequest(r.url()) === "local") sink.failedLocal.push(`${r.url()} (${r.failure()?.errorText ?? "failed"})`);
  });
  return page;
}

export async function waitMounted(page: Page, sink: PageSink): Promise<boolean> {
  try {
    await page.waitForSelector("[data-handoff-ready]", { timeout: 15_000 });
  } catch {
    sink.pageErrors.push("[verify] [data-handoff-ready] never appeared within 15 s");
    return false;
  }
  await new Promise((r) => setTimeout(r, 1500));
  return page.evaluate(() => !!document.querySelector(".est-root"));
}

/** The header's "Quoted total" figure, as rendered. */
export const readHeaderTotal = (page: Page) =>
  page.evaluate(() => {
    const label = [...document.querySelectorAll("div")].find((d) => d.children.length === 0 && d.textContent?.trim() === "Quoted total");
    return label?.nextElementSibling?.textContent?.trim() ?? null;
  });

export const pageHasText = (page: Page, text: string) => page.evaluate((t) => document.body.innerText.includes(t), text);

/** The unregistered server actions the page has called. A page with no hook answers NO_UNREGISTERED_HOOK, which no
 *  allow-list holds, so a missing hook fails the run instead of reading as "none called". */
export const unregisteredOn = (page: Page): Promise<string[]> =>
  page.evaluate((missing) => {
    const fn = (window as unknown as { __peakHandoff?: { calledUnregistered?: () => string[] } }).__peakHandoff?.calledUnregistered;
    return typeof fn === "function" ? fn() : [missing];
  }, NO_UNREGISTERED_HOOK);

type EstimateCheck = {
  id: string;
  number: string;
  pass: boolean;
  onScreen: string | null;
  expected: string;
  expectedCanonical: number;
  rawGrand: number;
  golden: { grand: number; file: string } | null;
  priceRound: boolean;
  bonusLines: boolean;
  numberShown: boolean;
  mounted: boolean;
  unexpectedUnregistered: string[];
  screenshot: string;
};

type StoreCheck = { pass: boolean; steps: Array<{ step: string; ok: boolean; detail?: string }> };

type EstimatorResult = { pass: boolean; checks: EstimateCheck[]; store: StoreCheck | null } & PageSink;

/** The overlay round trip on one estimate (put → reload → read back; tombstone; reset). */
async function storeCheck(page: Page, url: string, id: string, sink: PageSink, expectedTotal: string): Promise<StoreCheck> {
  const steps: StoreCheck["steps"] = [];
  const step = (name: string, ok: boolean, detail?: string) => steps.push({ step: name, ok, ...(detail ? { detail } : {}) });
  type H = { __peakHandoff: { store: { persistent: boolean; get(c: string, id: string): Promise<unknown>; put(c: string, d: unknown): Promise<void>; remove(c: string, id: string): Promise<void>; reset(): Promise<void>; all(c: string): Promise<unknown[]> } } };
  const marker = `VERIFY overlay ${id}`;
  const persistent = await page.evaluate(() => (window as unknown as H).__peakHandoff.store.persistent);
  step("IndexedDB opened (persistent)", persistent === true);
  const seedCount = await page.evaluate(async () => (await (window as unknown as H).__peakHandoff.store.all("quotes")).length);
  await page.evaluate(
    async (qid, name) => {
      const s = (window as unknown as H).__peakHandoff.store;
      const q = (await s.get("quotes", qid)) as Record<string, unknown>;
      await s.put("quotes", { ...q, name });
      await s.put("meta", { id: "verify-probe", at: 1 });
      await s.put("meta", { id: "verify-tomb", at: 1 });
      await s.remove("meta", "verify-tomb");
      // put order z → a → m: a reload must keep it (IndexedDB hands rows back in id order)
      for (const k of ["verify-z", "verify-a", "verify-m"]) await s.put("meta", { id: k, at: 1 });
    },
    id,
    marker,
  );
  await openUrl(page, url);
  await waitMounted(page, sink);
  step("a quote edit survives a reload and shows in the header", await pageHasText(page, marker));
  const after = await page.evaluate(async () => {
    const s = (window as unknown as H).__peakHandoff.store;
    const order = (await s.all("meta")).map((d) => (d as { id: string }).id).filter((i) => i.startsWith("verify-") && i !== "verify-probe" && i !== "verify-tomb");
    return { probe: !!(await s.get("meta", "verify-probe")), tomb: (await s.get("meta", "verify-tomb")) === undefined, count: (await s.all("quotes")).length, order: order.join(",") };
  });
  step("a put doc survives a reload", after.probe);
  step("a tombstone survives a reload", after.tomb);
  step("an edited seed quote is not duplicated", after.count === seedCount, `${after.count} vs ${seedCount}`);
  step("put order survives a reload (z, a, m — not id order)", after.order === "verify-z,verify-a,verify-m", after.order);
  await page.evaluate(async () => (window as unknown as H).__peakHandoff.store.reset());
  await openUrl(page, url);
  await waitMounted(page, sink);
  const probeGone = await page.evaluate(async () => (await (window as unknown as H).__peakHandoff.store.get("meta", "verify-probe")) === undefined);
  step("Reset drops the overlay (probe gone, name back)", probeGone && !(await pageHasText(page, marker)));
  const total = await readHeaderTotal(page);
  step("after Reset the header total is the snapshot's", total === expectedTotal, `${total} vs ${expectedTotal}`);
  return { pass: steps.every((s) => s.ok), steps };
}


/**
 * Reset from a second window (same file:// origin): the other window lets go of the database and goes
 * non-persistent, the reset completes and restores the snapshot; and a window that never lets go makes
 * reset() reject with "Close other prototype windows and try again.".
 */
async function resetAcrossWindows(browser: Browser, url: string, sink: PageSink): Promise<StoreCheck["steps"]> {
  const steps: StoreCheck["steps"] = [];
  const step = (name: string, ok: boolean, detail?: string) => steps.push({ step: name, ok, ...(detail ? { detail } : {}) });
  type S = { persistent: boolean; put(c: string, d: unknown): Promise<void>; get(c: string, id: string): Promise<unknown>; reset(): Promise<void> };
  type H = { __peakHandoff: { store: S } };
  const a = await newPage(browser, sink);
  const b = await newPage(browser, sink);
  const c = await newPage(browser, sink);
  try {
    await openUrl(a, url);
    await openUrl(b, url);
    await waitMounted(a, sink);
    await waitMounted(b, sink);
    await b.evaluate(async () => (window as unknown as H).__peakHandoff.store.put("meta", { id: "verify-xwin", at: 1 }));
    const aRes = await a.evaluate(async () => {
      const s = (window as unknown as H).__peakHandoff.store;
      try {
        await s.reset();
        return { ok: true, persistent: s.persistent, probe: !!(await s.get("meta", "verify-xwin")) };
      } catch (e) {
        return { ok: false, persistent: s.persistent, probe: true, error: (e as Error).message };
      }
    });
    step("Reset in one window completes while another has the data open", aRes.ok === true, aRes.error);
    step("the resetting window stays persistent and the probe is gone", aRes.persistent === true && aRes.probe === false);
    let bPersistent = true;
    for (let i = 0; i < 30 && bPersistent; i++) {
      bPersistent = await b.evaluate(() => (window as unknown as H).__peakHandoff.store.persistent);
      if (bPersistent) await new Promise((r) => setTimeout(r, 100));
    }
    step("the other window closed its connection (persistent false)", bPersistent === false);
    step('the other window shows "Changes won\'t be saved in this window"', await pageHasText(b, "Changes won't be saved in this window"));
    await openUrl(a, url);
    await waitMounted(a, sink);
    step("after a reload the snapshot is back (probe gone)", await a.evaluate(async () => (await (window as unknown as H).__peakHandoff.store.get("meta", "verify-xwin")) === undefined));

    // a window that never answers versionchange: Reset must say so instead of pretending
    // the raw hold opens the store's own (snapshot-keyed) database — its name read from the booted window `a`
    const dbName = await a.evaluate(() => (window as unknown as { __peakHandoff: { store: { dbName: string } } }).__peakHandoff.store.dbName);
    await openUrl(c, url);
    await c.evaluate((name) => new Promise<void>((resolve, reject) => {
      const r = indexedDB.open(name);
      (window as unknown as { __rawHold?: IDBDatabase }).__rawHold = undefined;
      r.onsuccess = () => {
        (window as unknown as { __rawHold?: IDBDatabase }).__rawHold = r.result; // no onversionchange handler
        resolve();
      };
      r.onerror = () => reject(r.error);
    }), dbName);
    const blocked = await a.evaluate(async () => {
      const s = (window as unknown as H).__peakHandoff.store;
      try {
        await s.reset();
        return { ok: true, message: "" };
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      }
    });
    step("a blocked Reset fails with the close-other-windows message", blocked.ok === false && /Close other prototype windows/.test(blocked.message), blocked.message);
    step("…and the window reports it can't save", (await a.evaluate(() => (window as unknown as H).__peakHandoff.store.persistent)) === false);
    await c.evaluate(() => (window as unknown as { __rawHold?: IDBDatabase }).__rawHold?.close());
  } finally {
    await a.close();
    await b.close();
    await c.close();
  }
  return steps;
}

async function estimatorCheck(pkgDir: string, which: string): Promise<EstimatorResult> {
  const index = path.join(pkgDir, "index.html");
  if (!existsSync(index)) throw new Error(`${index} not found — run npm run handoff:build first`);
  const data = loadSliceData(pkgDir);
  const quotes = which === "all" ? data.estimates : data.estimates.filter((q) => q.id === which);
  if (!quotes.length) throw new Error(`no estimate "${which}" in ${path.join(pkgDir, "data", "estimates.js")}`);
  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new Error(launch.unavailable);
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: launch.executablePath, args: launch.args, headless: true, defaultViewport: { width: 1440, height: 900 } });
  const sink = newSink();
  const checks: EstimateCheck[] = [];
  let store: StoreCheck | null = null;
  mkdirSync(VERIFY_DIR, { recursive: true });
  const allowed = new Set(SMOKE_ALLOWED_UNREGISTERED);
  try {
    for (const q of quotes) {
      const url = estimateUrl(pathToFileURL(index).href, q.id);
      const page = await newPage(browser, sink);
      const errorsBefore = sink.pageErrors.length;
      await openUrl(page, url);
      const mounted = await waitMounted(page, sink);
      const onScreen = await readHeaderTotal(page);
      const exp = expectedEstimatorTotals(q, data.rules);
      const number = displayQuoteNumber({ ...q, id: q.id });
      const numberShown = await pageHasText(page, number);
      const screenshot = path.join(VERIFY_DIR, `estimator-${q.id.replace(/[^A-Za-z0-9._-]/g, "_")}.png`);
      await page.screenshot({ path: screenshot as `${string}.png` });
      const unexpectedUnregistered = (await unregisteredOn(page)).filter((x) => !allowed.has(x));
      const expected = fmt(exp.canonical);
      checks.push({
        id: q.id, number, onScreen, expected, expectedCanonical: exp.canonical, rawGrand: exp.raw, golden: goldenGrand(q.id), priceRound: exp.priceRound, bonusLines: exp.bonusLines,
        numberShown, mounted, unexpectedUnregistered, screenshot,
        pass: mounted && numberShown && onScreen === expected && unexpectedUnregistered.length === 0 && sink.pageErrors.length === errorsBefore,
      });
      if (!store) {
        store = await storeCheck(page, url, q.id, sink, expected);
        await page.close();
        store.steps.push(...(await resetAcrossWindows(browser, url, sink)));
        store.pass = store.steps.every((s) => s.ok);
      } else await page.close();
    }
  } finally {
    await browser.close();
  }
  const pass = checks.every((c) => c.pass) && (store?.pass ?? false) && sink.pageErrors.length === 0 && sink.foreignRequests.length === 0 && sink.failedLocal.length === 0;
  return { pass, checks, store, ...sink };
}

function printEstimator(r: EstimatorResult): void {
  console.log(`handoff:verify --estimator  ${r.pass ? "PASS" : "FAIL"}`);
  for (const c of r.checks) {
    const golden = c.golden ? `golden ${fmt(c.golden.grand)} (${c.golden.file})` : "no golden file";
    console.log(`  ${c.pass ? "ok  " : "FAIL"} ${c.id} (${c.number}${c.numberShown ? "" : " NOT SHOWN"}): on screen ${c.onScreen ?? "—"} · expected ${c.expected}${[c.priceRound ? "$25 round" : "", c.bonusLines ? "bonus lines" : ""].filter(Boolean).map((x) => ` +${x}`).join("")} · raw totals() ${fmt(c.rawGrand)} · ${golden}`);
    if (c.unexpectedUnregistered.length) console.log(`       unexpected unregistered: ${c.unexpectedUnregistered.join(", ")}`);
  }
  if (r.store) {
    console.log(`  IndexedDB overlay: ${r.store.pass ? "PASS" : "FAIL"}`);
    for (const s of r.store.steps) console.log(`    ${s.ok ? "ok  " : "FAIL"} ${s.step}${s.detail ? ` (${s.detail})` : ""}`);
  }
  console.log(`  page errors: ${r.pageErrors.length}`);
  for (const e of r.pageErrors) console.log(`    ${e.split("\n").slice(0, 4).join("\n    ")}`);
  console.log(`  foreign requests: ${r.foreignRequests.length}; failed local files: ${r.failedLocal.length}`);
  for (const u of [...r.foreignRequests, ...r.failedLocal]) console.log(`    ${u}`);
  if (r.consoleErrors.length) {
    console.log(`  console errors (all but the benign ones are page errors too): ${r.consoleErrors.length}`);
    for (const e of r.consoleErrors.slice(0, 10)) console.log(`    ${e.slice(0, 200)}`);
  }
}

/* ------------------------------------------------------------------ --estimator-edit */

type EditResult = { pass: boolean; id: string; steps: Array<{ step: string; ok: boolean; detail?: string }>; unexpectedUnregistered: string[] } & PageSink;

export type EditH = { __peakHandoff: { store: { get(c: string, id: string): Promise<unknown>; all(c: string): Promise<unknown[]>; put(c: string, doc: { id: string }): Promise<void>; remove(c: string, id: string): Promise<void>; reset(): Promise<void> } } };

/** Clicks the first visible button whose trimmed text is `text` (or starts with it, `prefix`). */
export const clickButton = (page: Page, text: string, prefix = false) =>
  page.evaluate(
    (t, pre) => {
      const b = [...document.querySelectorAll("button")].find((x) => {
        const s = x.textContent?.trim() ?? "";
        return (pre ? s.startsWith(t) : s === t) && (x as HTMLElement).offsetParent !== null && !(x as HTMLButtonElement).disabled;
      });
      if (!b) return false;
      (b as HTMLButtonElement).click();
      return true;
    },
    text,
    prefix,
  );

export async function waitFor(fn: () => Promise<boolean>, ms = 10_000, every = 150): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, every));
  }
}

/** Body text plus every input's value (line descriptions can live in inputs). */
const pageHasTextOrValue = (page: Page, text: string) =>
  page.evaluate((t) => document.body.innerText.includes(t) || [...document.querySelectorAll("input,textarea")].some((i) => (i as HTMLInputElement).value.includes(t)), text);

/** The first priced line's qty input — the est-input with no aria-label in the row that holds the first "Unit sell for …" input. */
export async function firstQtyInput(page: Page) {
  const handle = await page.evaluateHandle(() => {
    const unit = document.querySelector('input[aria-label^="Unit sell for "]');
    let row: Element | null = unit?.parentElement ?? null;
    while (row && row.querySelectorAll('input[aria-label^="Unit sell for "]').length === 1) {
      const qty = [...row.querySelectorAll("input.est-input")].find((i) => !i.getAttribute("aria-label"));
      if (qty) return qty;
      row = row.parentElement;
    }
    return null;
  });
  return handle.asElement() as import("puppeteer-core").ElementHandle<HTMLInputElement> | null;
}

/**
 * The Build step really saves (PR 2 Task 4): qty +1 → Save → reload keeps the qty and the header total;
 * "+ Add part from catalog" → search → Add → Save → reload keeps the line; `?new=1` → add a system →
 * Save → the header shows an EST number above every seed estimate's.
 */
async function estimatorEditCheck(pkgDir: string, which: string | undefined): Promise<EditResult> {
  const index = path.join(pkgDir, "index.html");
  if (!existsSync(index)) throw new Error(`${index} not found — run npm run handoff:build first`);
  const data = loadSliceData(pkgDir);
  const q = (which && which !== "all" ? data.estimates.find((x) => x.id === which) : data.estimates.find((x) => x.id === "Q-G001") ?? data.estimates[0]) ?? null;
  if (!q) throw new Error(`no estimate${which ? ` "${which}"` : ""} in the slice`);
  const maxSeedEstNo = Math.max(0, ...data.estimates.map((e) => (typeof e.estNo === "number" ? e.estNo : 0)));
  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new Error(launch.unavailable);
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: launch.executablePath, args: launch.args, headless: true, defaultViewport: { width: 1440, height: 900 } });
  const sink = newSink();
  const steps: EditResult["steps"] = [];
  const step = (name: string, ok: boolean, detail?: string) => steps.push({ step: name, ok, ...(detail ? { detail } : {}) });
  const allowed = new Set(SMOKE_ALLOWED_UNREGISTERED);
  const unexpected = new Set<string>();
  const noteUnregistered = async (page: Page) => (await unregisteredOn(page)).filter((x) => !allowed.has(x)).forEach((x) => unexpected.add(x));
  const base = pathToFileURL(index).href;
  const url = estimateUrl(base, q.id);
  const savedFlash = (page: Page) => waitFor(() => pageHasText(page, "Saved ✓"), 10_000);
  const saveError = (page: Page) => page.evaluate(() => /Not available in the prototype|did not go through/.test(document.body.innerText));
  try {
    const page = await newPage(browser, sink);
    await openUrl(page, url);
    await page.waitForSelector("[data-handoff-ready]", { timeout: 15_000 });
    // A clean overlay: this profile is fresh, but reset anyway so a rerun never builds on old edits.
    await page.evaluate(async () => (window as unknown as EditH).__peakHandoff.store.reset());
    await openUrl(page, url);
    step("estimate mounted", await waitMounted(page, sink));

    // 1 — qty +1, Save, reload
    const qtyEl = await firstQtyInput(page);
    const qty0 = qtyEl ? Number(await qtyEl.evaluate((i) => i.value)) : NaN;
    step("found the first line's qty", !!qtyEl && Number.isFinite(qty0), String(qty0));
    const total0 = await readHeaderTotal(page);
    if (qtyEl) {
      await qtyEl.click({ count: 3 });
      await qtyEl.type(String(qty0 + 1));
      await page.keyboard.press("Tab");
    }
    const changed = await waitFor(async () => (await readHeaderTotal(page)) !== total0, 5000);
    // The bonus lines and the $25 round re-derive in effects after the edit — wait for the figure to settle.
    let total1 = await readHeaderTotal(page);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const t = await readHeaderTotal(page);
      if (t === total1 && i >= 3) break;
      total1 = t;
    }
    step("the header total moved with the qty", changed, `${total0} → ${total1}`);
    const refreshes = () => page.evaluate(() => (window as unknown as { __peakHandoff?: { propsRefreshes?: number } }).__peakHandoff?.propsRefreshes ?? 0);
    const refreshesBefore = await refreshes();
    await clickButton(page, "Save");
    const saved1 = await savedFlash(page);
    step("Save shows Saved ✓", saved1, (await saveError(page)) ? "save refused (Not available in the prototype)" : undefined);
    step("the save refreshed the props (router.refresh → buildEstimatorProps)", await waitFor(async () => (await refreshes()) > refreshesBefore, 3000), `${refreshesBefore} → ${await refreshes()}`);
    await noteUnregistered(page);
    await openUrl(page, url);
    await waitMounted(page, sink);
    const qtyAfter = await firstQtyInput(page);
    const qty1 = qtyAfter ? Number(await qtyAfter.evaluate((i) => i.value)) : NaN;
    step("after a reload the qty is the saved one", qty1 === qty0 + 1, `${qty1} vs ${qty0 + 1}`);
    const totalAfter = await readHeaderTotal(page);
    step("after a reload the header total is the saved one", totalAfter === total1 && total1 !== total0, `${totalAfter} vs ${total1}`);
    const storedValue = await page.evaluate(async (id) => ((await (window as unknown as EditH).__peakHandoff.store.get("quotes", id)) as { value?: number } | undefined)?.value ?? null, q.id);
    const shown = Number(String(totalAfter ?? "").replace(/[^0-9.-]/g, ""));
    step("the stored value is the header total (server-reconciled)", storedValue !== null && Math.round(shown) === storedValue, `${storedValue} vs ${totalAfter}`);

    // 2 — + Add part from catalog → search → Add → Save → reload
    const opened = await clickButton(page, "+ Add part from catalog");
    step("+ Add part from catalog opens the picker", opened && (await waitFor(() => page.evaluate(() => !!document.querySelector('input[placeholder^="Search the catalog"]')), 3000)));
    const search = await page.$('input[placeholder^="Search the catalog"]');
    await search?.type("ColorSource");
    const hit = await waitFor(() => page.evaluate(() => document.querySelectorAll(".est-sug").length > 0), 5000);
    const hitInfo = await page.evaluate(() => {
      const row = document.querySelector(".est-sug");
      const desc = row?.querySelector("span span")?.textContent?.trim() ?? "";
      const sku = (row?.querySelector("span span + span")?.textContent ?? "").split(" · ")[0].trim();
      return { desc, sku };
    });
    step('searching "ColorSource" lists catalog parts', hit, `${hitInfo.desc} (${hitInfo.sku})`);
    const added = await page.evaluate(() => {
      const b = [...(document.querySelector(".est-sug")?.querySelectorAll("button") ?? [])].find((x) => x.textContent?.trim() === "Add");
      b?.click();
      return !!b;
    });
    step("Add puts the part on the system", added && (await waitFor(() => pageHasText(page, "✓ Added"), 3000)));
    await clickButton(page, "Save");
    step("Save shows Saved ✓ (catalog line)", await savedFlash(page));
    await noteUnregistered(page);
    await openUrl(page, url);
    await waitMounted(page, sink);
    const stored = await page.evaluate(async (id) => JSON.stringify((await (window as unknown as EditH).__peakHandoff.store.get("quotes", id)) ?? null), q.id);
    step("after a reload the added line is in the store", !!hitInfo.sku && stored.includes(`"sku":${JSON.stringify(hitInfo.sku)}`), hitInfo.sku);
    step("after a reload the added line is on the page", !!hitInfo.desc && (await pageHasTextOrValue(page, hitInfo.desc)), hitInfo.desc);
    await noteUnregistered(page);
    await page.close();

    // 3 — ?new=1 → add a system → Save → EST-<n> above the seed
    const np = await newPage(browser, sink);
    await openUrl(np, newEstimateUrl(base));
    step("?new=1 opens a new, unsaved estimate (no EST number yet)", (await waitMounted(np, sink)) && !(await np.evaluate(() => /EST-\d+/.test(document.body.innerText))));
    const hasSystem = await np.evaluate(() => !!document.querySelector("input.est-secname"));
    if (!hasSystem) {
      await clickButton(np, "+ Add system");
      await waitFor(() => pageHasText(np, "Blank system"), 3000);
      await clickButton(np, "Blank system", true);
    }
    step(hasSystem ? "the new estimate has a system (it opens with one)" : "the new estimate has a system (+ Add system → Blank system)", await waitFor(() => np.evaluate(() => !!document.querySelector("input.est-secname")), 3000));
    await clickButton(np, "Save");
    step("Save shows Saved ✓ (new estimate)", await savedFlash(np), (await saveError(np)) ? "save refused" : undefined);
    const nums = await np.evaluate(() => [...document.body.innerText.matchAll(/EST-(\d+)/g)].map((m) => Number(m[1])));
    const newNo = nums.find((n) => n > maxSeedEstNo);
    step(`the header shows an EST number above the seed's max (${maxSeedEstNo})`, newNo !== undefined, newNo ? `EST-${newNo}` : nums.join(","));
    const newUrl = await np.evaluate(() => window.location.search + window.location.hash);
    const newId = new URLSearchParams(newUrl.split("#")[0]).get("id");
    const seedIds = new Set(data.estimates.map((e) => e.id));
    step("the URL moved to the new estimate's id", !!newId && !seedIds.has(newId), newUrl);
    if (newId && !seedIds.has(newId)) {
      await openUrl(np, `${base}${newUrl}`);
      await waitMounted(np, sink);
      step("after a reload the new estimate reopens with its number", newNo !== undefined && (await pageHasText(np, `EST-${newNo}`)));
    }
    await noteUnregistered(np);
    await np.close();
  } finally {
    await browser.close();
  }
  const unexpectedUnregistered = [...unexpected];
  const pass = steps.every((s) => s.ok) && unexpectedUnregistered.length === 0 && sink.pageErrors.length === 0 && sink.foreignRequests.length === 0 && sink.failedLocal.length === 0;
  return { pass, id: q.id, steps, unexpectedUnregistered, ...sink };
}

function printEdit(r: EditResult): void {
  console.log(`handoff:verify --estimator-edit  ${r.pass ? "PASS" : "FAIL"} (${r.id})`);
  for (const s of r.steps) console.log(`  ${s.ok ? "ok  " : "FAIL"} ${s.step}${s.detail ? ` (${s.detail})` : ""}`);
  console.log(`  unexpected unregistered: ${r.unexpectedUnregistered.length}`);
  for (const x of r.unexpectedUnregistered) console.log(`    ${x}`);
  console.log(`  page errors: ${r.pageErrors.length}`);
  for (const e of r.pageErrors) console.log(`    ${e.split("\n").slice(0, 4).join("\n    ")}`);
  console.log(`  foreign requests: ${r.foreignRequests.length}; failed local files: ${r.failedLocal.length}`);
  if (r.consoleErrors.length) {
    console.log(`  console errors (all but the benign ones are page errors too): ${r.consoleErrors.length}`);
    for (const e of r.consoleErrors.slice(0, 10)) console.log(`    ${e.slice(0, 200)}`);
  }
}

/* ------------------------------------------------------------------ --review */

type ReviewResult = { pass: boolean; id: string; steps: Array<{ step: string; ok: boolean; detail?: string }>; screenshots: string[]; unexpectedUnregistered: string[] } & PageSink;

/** The visible tab button (role=tab) whose text is `label` → click it. */
const clickTab = (page: Page, label: string) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll('[role="tab"]')].find((x) => x.textContent?.trim() === t && (x as HTMLElement).offsetParent !== null) as HTMLElement | undefined;
    b?.click();
    return !!b;
  }, label);

/** The open review tabpanel's text and whether it holds a frame of the staff preview route. */
const panelState = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector('[role="tabpanel"]') as HTMLElement | null;
    const frames = [...document.querySelectorAll("iframe")].map((f) => f.getAttribute("src") || "");
    return {
      text: (panel?.innerText ?? "").trim(),
      previewFrame: frames.some((s) => s.includes("/estimator-preview")),
      anyFrame: frames.length,
      letterhead: [...(panel?.querySelectorAll("img") ?? [])].some((i) => /peak-letterhead/.test(i.getAttribute("src") || "") && (i as HTMLImageElement).naturalWidth > 0),
    };
  });

/** Under print media: the print root's footer text, whether its cut-sheet appendix shows (and its text), and the banner. */
const printRootState = (page: Page) =>
  page.evaluate(() => {
    // No named inner functions here: tsx's keepNames would wrap them in __name, which the page lacks.
    const [footer, cs, banner] = ["#handoff-print-root [data-handoff-print-footer]", "#handoff-print-root [data-handoff-print-cutsheets]", "[data-handoff-banner]"].map((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" ? el : null;
    });
    return {
      footer: footer ? footer.innerText.trim() : null,
      cutSheets: !!cs,
      cutSheetText: cs ? cs.innerText.slice(0, 2000) : "",
      banner: !!banner,
    };
  });

/**
 * Task 5 — the customer-facing views render live from the store: Build package → BOM quote (letterhead +
 * expected grand total), Customer review's Document / Package page / BOM tabs (content, no
 * /estimator-preview frame), a review comment that survives a reload, and Print → PDF (print media shows
 * the document only).
 */
async function reviewCheck(pkgDir: string, which: string | undefined): Promise<ReviewResult> {
  const index = path.join(pkgDir, "index.html");
  if (!existsSync(index)) throw new Error(`${index} not found — run npm run handoff:build first`);
  const data = loadSliceData(pkgDir);
  const q = (which ? data.estimates.find((x) => x.id === which) : data.estimates.find((x) => x.id === "Q-G001") ?? data.estimates[0]) ?? null;
  if (!q) throw new Error(`no estimate${which ? ` "${which}"` : ""} in the slice`);
  const expected = fmt(expectedEstimatorTotals(q, data.rules).canonical);
  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new Error(launch.unavailable);
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: launch.executablePath, args: launch.args, headless: true, defaultViewport: { width: 1440, height: 900 } });
  const sink = newSink();
  const steps: ReviewResult["steps"] = [];
  const step = (name: string, ok: boolean, detail?: string) => steps.push({ step: name, ok, ...(detail ? { detail } : {}) });
  const screenshots: string[] = [];
  const shot = async (page: Page, name: string) => {
    const file = path.join(VERIFY_DIR, `review-${name}.png`);
    await page.screenshot({ path: file as `${string}.png` });
    screenshots.push(file);
  };
  const allowed = new Set(SMOKE_ALLOWED_UNREGISTERED);
  const unexpected = new Set<string>();
  const noteUnregistered = async (page: Page) => (await unregisteredOn(page)).filter((x) => !allowed.has(x)).forEach((x) => unexpected.add(x));
  const base = pathToFileURL(index).href;
  const url = (stepName: string, extra = "") => estimateUrl(base, q.id, `step=${stepName}${extra}`);
  mkdirSync(VERIFY_DIR, { recursive: true });
  try {
    const page = await newPage(browser, sink);
    await openUrl(page, url("package", "&ptab=bom"));
    await page.waitForSelector("[data-handoff-ready]", { timeout: 15_000 });
    await page.evaluate(async () => (window as unknown as EditH).__peakHandoff.store.reset());
    await openUrl(page, url("package", "&ptab=bom"));
    step("estimate mounted", await waitMounted(page, sink));

    // 1 — Build package → BOM quote: the letterhead and the grand total
    await clickTab(page, "BOM quote");
    const bom = await waitFor(
      () =>
        page.evaluate((total) => {
          const doc = document.querySelector(".est-doc") as HTMLElement | null;
          const img = [...(doc?.querySelectorAll("img") ?? [])].find((i) => /peak-letterhead/.test(i.getAttribute("src") || ""));
          return !!doc && !!img && (img as HTMLImageElement).naturalWidth > 0 && doc.innerText.includes(total);
        }, expected),
      10_000,
    );
    step("Build package → BOM quote shows the letterhead and the grand total", bom, expected);
    await shot(page, "package-bom");
    await noteUnregistered(page);

    // 2 — Customer review: Document, Package page, BOM and Cut sheets render live
    const savedGrand = fmt(totals(Array.isArray(q.spec?.sections) ? (q.spec!.sections as SpecSection[]) : [], 0).grand);
    await openUrl(page, url("review"));
    await waitMounted(page, sink);
    for (const [tab, name] of [["Document", "document"], ["Package page", "package"], ["BOM", "bom"]] as const) {
      const clicked = await clickTab(page, tab);
      let st = await panelState(page);
      // The package page: the saved grand total and its Summary heading (PackageView), not just "some text".
      const packageOk = (x: typeof st) => x.text.includes(savedGrand) && /\bSummary\b/.test(x.text);
      const ready = (x: typeof st) => x.text.length > 200 && (tab === "Package page" ? packageOk(x) : x.letterhead);
      await waitFor(async () => {
        st = await panelState(page);
        return ready(st);
      }, 10_000);
      step(`Customer review → ${tab} renders content (no /estimator-preview frame)`, clicked && ready(st) && !st.previewFrame, `${st.text.length} chars, frames ${st.anyFrame}${tab === "Package page" ? `, total ${savedGrand} + Summary ${packageOk(st)}` : `, letterhead ${st.letterhead}`}`);
      if (tab === "BOM") step("Customer review → BOM shows the saved grand total", st.text.includes(savedGrand));
      await shot(page, `tab-${name}`);
    }
    {
      const clicked = await clickTab(page, "Cut sheets");
      const shown = await waitFor(async () => (await panelState(page)).text.includes(PREVIEW_COPY.noCurtains), 10_000);
      step("Customer review → Cut sheets renders live (no curtains on this estimate → the app's copy)", clicked && shown && !(await panelState(page)).previewFrame);
    }
    await noteUnregistered(page);

    // 3 — a review comment survives a reload
    const note = `VERIFY comment ${Date.now()}`;
    const box = await page.$('textarea[placeholder="What should change?"]');
    step("the comment box is there", !!box);
    if (box) {
      await box.type(note);
      await clickButton(page, "Add comment");
    }
    step("the comment shows after Add comment", await waitFor(() => pageHasText(page, note), 5000));
    await openUrl(page, url("review"));
    await waitMounted(page, sink);
    step("the comment survives a reload", await waitFor(() => pageHasText(page, note), 5000));
    await noteUnregistered(page);

    // 4 — Print → PDF: print media shows the document only
    await clickTab(page, "Document");
    await page.evaluate(() => {
      (window as unknown as { __printed?: number }).__printed = 0;
      window.print = () => {
        const w = window as unknown as { __printed?: number };
        w.__printed = (w.__printed ?? 0) + 1;
      };
    });
    const printed = await clickButton(page, "Print / Save as PDF");
    step("Print / Save as PDF calls window.print()", printed && (await page.evaluate(() => (window as unknown as { __printed?: number }).__printed === 1)));
    await page.emulateMediaType("print");
    const printView = await page.evaluate(() => {
      // No named inner functions here: tsx's keepNames would wrap them in __name, which the page lacks.
      const visible = [...document.querySelectorAll("[data-handoff-banner], .est-root, .est-doc, button")].filter(
        (el) => (el as HTMLElement).getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden",
      );
      const docs = visible.filter((el) => el.classList.contains("est-doc"));
      return {
        banner: visible.some((el) => el.hasAttribute("data-handoff-banner")),
        stepTabs: visible.some((el) => el.tagName === "BUTTON" && /^\d · /.test(el.textContent?.trim() ?? "")),
        root: visible.some((el) => el.classList.contains("est-root")),
        doc: docs.length,
        docText: docs.map((d) => (d as HTMLElement).innerText.length).reduce((a, b) => a + b, 0),
      };
    });
    step("print media hides the Estimator chrome (banner, header, step tabs)", !printView.banner && !printView.stepTabs && !printView.root, JSON.stringify(printView));
    step("print media shows the document", printView.doc === 1 && printView.docText > 200, `${printView.doc} document(s), ${printView.docText} chars`);
    const printExtras = await printRootState(page);
    step("print media shows the confidential footer", printExtras.footer === PRINT_FOOTER_TEXT, JSON.stringify(printExtras));
    step("print media: no cut-sheet appendix when the quote doesn't ask for one", !printExtras.cutSheets, JSON.stringify(printExtras));
    await shot(page, "print");
    await page.emulateMediaType("screen");
    await noteUnregistered(page);

    // 5 — the package page's Narrative / BOM toggle switches in place (never the overlay) — on Q-G002
    const toggleId = data.estimates.some((x) => x.id === "Q-G002") ? "Q-G002" : q.id;
    const urlFor = (id: string, extra = "") => estimateUrl(base, id, `step=review${extra}`);
    await openUrl(page, urlFor(toggleId));
    await waitMounted(page, sink);
    await clickTab(page, "Package page");
    const togglesShown = await waitFor(() => page.evaluate(() => document.querySelectorAll('[data-handoff-live="package"] nav a').length === 2), 10_000);
    const clickToggle = (bom: boolean) =>
      page.evaluate((b) => {
        const a = [...document.querySelectorAll('[data-handoff-live="package"] nav a')].find((x) => (x.getAttribute("href") || "").includes("view=bom") === b) as HTMLElement | undefined;
        a?.click();
        return !!a;
      }, bom);
    const toggleState = () =>
      page.evaluate(() => {
        const cur = document.querySelector('[data-handoff-live="package"] nav a[aria-current="page"]');
        return { overlay: !!document.querySelector("[data-handoff-overlay]"), view: cur ? ((cur.getAttribute("href") || "").includes("view=bom") ? "bom" : "narrative") : null, href: location.href.split("?")[1] ?? "" };
      });
    const hrefBefore = (await toggleState()).href;
    const toBom = togglesShown && (await clickToggle(true));
    const bomIn = await waitFor(async () => (await toggleState()).view === "bom", 5000);
    const afterBom = await toggleState();
    step(`Package page → BOM toggle switches the tab in place, no overlay (${toggleId})`, toBom && bomIn && !afterBom.overlay && afterBom.href === hrefBefore, JSON.stringify(afterBom));
    await shot(page, "package-toggle-bom");
    const toNarr = await clickToggle(false);
    const narrIn = await waitFor(async () => (await toggleState()).view === "narrative", 5000);
    const afterNarr = await toggleState();
    step(`Package page → Narrative toggle switches back in place, no overlay (${toggleId})`, toNarr && narrIn && !afterNarr.overlay, JSON.stringify(afterNarr));

    // 6 — the ⧉ pop-out: a notice, no window, no overlay
    const pagesBefore = (await browser.pages()).length;
    const popClicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button[aria-label="Open in its own window"]')].find((x) => (x as HTMLElement).offsetParent !== null) as HTMLElement | undefined;
      b?.click();
      return !!b;
    });
    const noticeShown = await waitFor(() => page.evaluate((t) => document.querySelector("[data-handoff-notice]")?.textContent === t, POPOUT_NOTICE), 3000);
    const popState = await page.evaluate(() => ({ overlay: !!document.querySelector("[data-handoff-overlay]"), est: !!document.querySelector(".est-root") }));
    step("the ⧉ pop-out shows the 'not in the prototype' notice and opens no window", popClicked && noticeShown && !popState.overlay && popState.est && (await browser.pages()).length === pagesBefore, `clicked ${popClicked}, pages ${pagesBefore} → ${(await browser.pages()).length}`);

    // 7 — More ▾ → Cut sheets opens the overlay; Esc closes it; the deferred stand-in (window.open("", "_blank")) navigates via replace; ✕ closes
    const overlayKind = () => page.evaluate(() => document.querySelector("[data-handoff-overlay]")?.getAttribute("data-handoff-overlay") ?? null);
    const more = await clickButton(page, "More ▾");
    const cutItem = more && (await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent?.trim() === "Cut sheets") as HTMLElement | undefined;
      b?.click();
      return !!b;
    }));
    const opened = await waitFor(async () => (await overlayKind()) === "cutsheets", 5000);
    step("More ▾ → Cut sheets opens the cut-sheet overlay", !!cutItem && opened, `kind ${await overlayKind()}`);
    await page.keyboard.press("Escape");
    step("Esc closes the overlay", await waitFor(async () => (await overlayKind()) === null, 3000));
    const stub = await page.evaluate((id) => {
      const w = window.open("", "_blank");
      if (!w) return "null";
      w.location.replace(`/estimator/cut-sheets?id=${encodeURIComponent(id)}&style=client`);
      return "ok";
    }, toggleId);
    step('window.open("", "_blank") → location.replace(cut sheets) opens the overlay (openCutSheets\' dirty path)', stub === "ok" && (await waitFor(async () => (await overlayKind()) === "cutsheets", 3000)));
    await shot(page, "overlay-cutsheets");
    const closed = await page.evaluate(() => {
      const b = document.querySelector('[data-handoff-overlay] button[aria-label="Close"]') as HTMLElement | null;
      b?.click();
      return !!b;
    });
    step("✕ closes the overlay", closed && (await waitFor(async () => (await overlayKind()) === null, 3000)));
    await noteUnregistered(page);

    // 8 — a curtain line + "Cut sheets" on the PDF: the Cut sheets tab shows its sheet, and the print root appends them (print route #292)
    const injected = await page.evaluate(async (id) => {
      const s = (window as unknown as { __peakHandoff: { store: { all(c: string): Promise<Array<Record<string, unknown>>>; get(c: string, id: string): Promise<Record<string, unknown> | null>; put(c: string, d: unknown): Promise<void> } } }).__peakHandoff.store;
      const fab = (await s.all("catalog")).find((p) => p.category === "Fabric");
      const qd = (await s.get("quotes", id)) as { spec: { sections: Array<{ items: Array<Record<string, unknown>> }> }; pdfOptions?: Record<string, unknown> } | null;
      const it = qd?.spec?.sections?.[0]?.items?.[0];
      if (!qd || !it) return false;
      qd.spec.sections[0].items[0] = { ...it, curtain: true, curtainInputs: { name: "Main Drape", fabricSku: (fab?.sku as string) ?? "", fabricName: (fab?.desc as string) ?? "Velour", qty: "2", width: "21.5", height: "18", fullness: "50", mountType: "wall-hookloop" } };
      qd.pdfOptions = { ...(qd.pdfOptions ?? {}), pdfCutSheets: true };
      await s.put("quotes", qd);
      return true;
    }, toggleId);
    await openUrl(page, urlFor(toggleId));
    await waitMounted(page, sink);
    await clickTab(page, "Cut sheets");
    // The Client style heads each sheet "Curtain cut sheet · EST-…" and names the curtain (Submittal prints CS-1).
    const sheetShown = (t: string) => t.includes("Curtain cut sheet") && t.includes("Main Drape");
    const cs1 = await waitFor(async () => sheetShown((await panelState(page)).text), 10_000);
    step(`Customer review → Cut sheets shows the curtain line's Client cut sheet (${toggleId}, injected)`, injected && cs1);
    await shot(page, "tab-cutsheets");
    await clickTab(page, "Document");
    await waitFor(() => page.evaluate(() => !!document.querySelector("#handoff-print-root [data-handoff-print-cutsheets]")), 10_000);
    await page.emulateMediaType("print");
    const withSheets = await printRootState(page);
    step("print media appends the Client cut sheets when the quote asks for them", withSheets.cutSheets && sheetShown(withSheets.cutSheetText) && withSheets.footer === PRINT_FOOTER_TEXT && !withSheets.banner, JSON.stringify(withSheets));
    await shot(page, "print-cutsheets");
    await page.emulateMediaType("screen");
    await page.evaluate(async () => (window as unknown as EditH).__peakHandoff.store.reset());
    await noteUnregistered(page);
    await page.close();
  } finally {
    await browser.close();
  }
  const unexpectedUnregistered = [...unexpected];
  const pass = steps.every((s) => s.ok) && unexpectedUnregistered.length === 0 && sink.pageErrors.length === 0 && sink.foreignRequests.length === 0 && sink.failedLocal.length === 0;
  return { pass, id: q.id, steps, screenshots, unexpectedUnregistered, ...sink };
}

function printReview(r: ReviewResult): void {
  console.log(`handoff:verify --review  ${r.pass ? "PASS" : "FAIL"} (${r.id})`);
  for (const s of r.steps) console.log(`  ${s.ok ? "ok  " : "FAIL"} ${s.step}${s.detail ? ` (${s.detail})` : ""}`);
  console.log(`  unexpected unregistered: ${r.unexpectedUnregistered.length}`);
  for (const x of r.unexpectedUnregistered) console.log(`    ${x}`);
  console.log(`  page errors: ${r.pageErrors.length}`);
  for (const e of r.pageErrors) console.log(`    ${e.split("\n").slice(0, 4).join("\n    ")}`);
  console.log(`  foreign requests: ${r.foreignRequests.length}; failed local files: ${r.failedLocal.length}`);
  for (const u of [...r.foreignRequests, ...r.failedLocal]) console.log(`    ${u}`);
  if (r.consoleErrors.length) {
    console.log(`  console errors (all but the benign ones are page errors too): ${r.consoleErrors.length}`);
    for (const e of r.consoleErrors.slice(0, 10)) console.log(`    ${e.slice(0, 200)}`);
  }
  console.log(`  screenshots: ${r.screenshots.map((f) => path.relative(ROOT, f)).join(", ")}`);
}

/* ------------------------------------------------------------------ --send */

type SendResult = { pass: boolean; id: string; estimator: string; manager: string; steps: Array<{ step: string; ok: boolean; detail?: string }>; screenshots: string[]; unexpectedUnregistered: string[] } & PageSink;

/** The verify-only Estimator persona the --send walk acts as (the dev slice's roster holds no Estimator-only member). */
export const VERIFY_ESTIMATOR = { id: "u-verify-est", name: "Erin Verify", roles: ["Estimator"], status: "active" } as const;

/**
 * Appends VERIFY_ESTIMATOR to the roster data/team.js sets (window.PEAK_TEAM), before any page script runs. A string,
 * not a function: tsx's keepNames would wrap a named inner function in __name, which the page lacks.
 */
const ROSTER_INJECT = `(() => {
  let team;
  const extra = ${JSON.stringify(VERIFY_ESTIMATOR)};
  Object.defineProperty(window, "PEAK_TEAM", {
    configurable: true,
    get: () => team,
    set: (v) => { team = Array.isArray(v) ? v.filter((u) => u && u.id !== extra.id).concat([extra]) : v; },
  });
})();`;

/** The slice's team.js roster (Node sandbox). */
export function sliceTeam(pkgDir: string): Array<{ id: string; name: string; roles?: string[]; status?: string }> {
  const window: Record<string, unknown> = {};
  const file = path.join(pkgDir, "data", "team.js");
  if (existsSync(file)) vm.runInContext(readFileSync(file, "utf8"), vm.createContext({ window }), { filename: file });
  return Array.isArray(window.PEAK_TEAM) ? (window.PEAK_TEAM as Array<{ id: string; name: string; roles?: string[]; status?: string }>) : [];
}

/** The Send & track Activity card's text ("" when it isn't on the page). */
const activityText = (page: Page) => page.evaluate(() => (document.querySelector('section[aria-label="Activity"]') as HTMLElement | null)?.innerText ?? "");

/** The composer field labelled `label` (To / Cc / Subject / Body) → its current value, or null. */
const composerValue = (page: Page, label: string) =>
  page.evaluate((l) => {
    const lab = [...document.querySelectorAll('section[aria-label="Email the estimate"] label')].find((x) => x.querySelector("span")?.textContent?.trim() === l);
    const f = lab?.querySelector("input,textarea") as HTMLInputElement | HTMLTextAreaElement | null;
    return f ? f.value : null;
  }, label);

/**
 * Task 6 — Send & track, simulated: as an Estimator-only member, Submit for approval; as a Manager, Approve only (owner
 * sends); the composer opens pre-filled; Send & mark sent → the quote is Sent, the Activity card shows "Sent (simulated)"
 * and a reload keeps both; Mark Won → the Activity shows the onWon port's "Would create install project" note. Nothing
 * leaves the browser (0 foreign requests). The store is reset after.
 */
async function sendCheck(pkgDir: string, which: string | undefined): Promise<SendResult> {
  const index = path.join(pkgDir, "index.html");
  if (!existsSync(index)) throw new Error(`${index} not found — run npm run handoff:build first`);
  const data = loadSliceData(pkgDir);
  // Default: the default estimate, Q-G001 (a golden fixture, stored as a draft) — the whole Submit → Approve → Send → Won
  // flow runs on what a first-time user sees; with no Q-G001 in the slice, the first stored draft system estimate.
  const q = (which
    ? data.estimates.find((x) => x.id === which)
    : data.estimates.find((x) => x.id === "Q-G001") ?? data.estimates.find((x) => x.status === "draft" && (x.quoteType ?? "system") === "system") ?? data.estimates[0]) ?? null;
  if (!q) throw new Error(`no estimate${which ? ` "${which}"` : ""} in the slice`);
  const manager = sliceTeam(pkgDir).find((u) => (u.status ?? "active") === "active" && (u.roles ?? []).includes("Manager"));
  if (!manager) throw new Error("the slice's roster has no active Manager");
  const number = displayQuoteNumber({ ...q, id: q.id });
  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new Error(launch.unavailable);
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: launch.executablePath, args: launch.args, headless: true, defaultViewport: { width: 1440, height: 1000 } });
  const sink = newSink();
  const steps: SendResult["steps"] = [];
  const step = (name: string, ok: boolean, detail?: string) => steps.push({ step: name, ok, ...(detail ? { detail } : {}) });
  const screenshots: string[] = [];
  const shot = async (page: Page, name: string) => {
    const file = path.join(VERIFY_DIR, `send-${name}.png`);
    await page.screenshot({ path: file as `${string}.png`, fullPage: true });
    screenshots.push(file);
  };
  const allowed = new Set(SMOKE_ALLOWED_UNREGISTERED);
  const unexpected = new Set<string>();
  const noteUnregistered = async (page: Page) => (await unregisteredOn(page)).filter((x) => !allowed.has(x)).forEach((x) => unexpected.add(x));
  const url = estimateUrl(pathToFileURL(index).href, q.id, "step=send");
  type Stored = { status?: string; review?: { state?: string; submittedBy?: string | null; decidedBy?: string | null }; revisions?: Array<{ reason?: string }>; estimateEmails?: unknown[] };
  const stored = (page: Page) => page.evaluate(async (id) => (await (window as unknown as EditH).__peakHandoff.store.get("quotes", id)) as Record<string, unknown> | null, q.id) as Promise<Stored | null>;
  const activityRows = (page: Page) =>
    page.evaluate(async (id) => ((await (window as unknown as EditH).__peakHandoff.store.all("activity")) as Array<Record<string, unknown>>).filter((a) => a.quoteId === id), q.id);
  const actAs = async (page: Page, userId: string) => {
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [CURRENT_USER_KEY, userId] as const);
    await openUrl(page, url);
    return waitMounted(page, sink);
  };
  const statusValue = (page: Page) => page.evaluate(() => (document.getElementById("est-send-status-select") as HTMLSelectElement | null)?.value ?? null);
  mkdirSync(VERIFY_DIR, { recursive: true });
  try {
    const page = await newPage(browser, sink);
    await page.evaluateOnNewDocument(ROSTER_INJECT);
    await openUrl(page, url);
    await page.waitForSelector("[data-handoff-ready]", { timeout: 15_000 });
    await page.evaluate(async () => (window as unknown as EditH).__peakHandoff.store.reset());

    // 1 — the Estimator submits for approval
    step(`acting as ${VERIFY_ESTIMATOR.name} (Estimator only) — Send & track mounted`, await actAs(page, VERIFY_ESTIMATOR.id));
    const submitted = (await waitFor(() => clickButton(page, "Submit for approval"), 5000)) && (await waitFor(() => pageHasText(page, "In review"), 10_000));
    const s1 = await stored(page);
    step("Submit for approval → In review", submitted && s1?.review?.state === "in_review" && s1.review.submittedBy === VERIFY_ESTIMATOR.name, JSON.stringify(s1?.review ?? null));
    await shot(page, "1-submitted");
    await noteUnregistered(page);

    // 2 — the Manager approves (Approve only — the composer sends)
    step(`acting as ${manager.name} (Manager)`, await actAs(page, manager.id));
    step("the Manager sees Approve & send →", await waitFor(() => pageHasText(page, "Approve & send →"), 5000));
    const menu = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button[aria-label="More approval actions"]')].find((x) => (x as HTMLElement).offsetParent !== null) as HTMLElement | undefined;
      b?.click();
      return !!b;
    });
    const approved = menu && (await waitFor(() => clickButton(page, "Approve only (owner sends)"), 3000)) && (await waitFor(() => pageHasText(page, "Approved · "), 10_000));
    const s2 = await stored(page);
    step("Approve only → Approved", approved && s2?.review?.state === "approved" && s2.review.decidedBy === manager.name, JSON.stringify(s2?.review ?? null));
    await noteUnregistered(page);

    // 3 — the composer is pre-filled; Send & mark sent (the app moves an approver on to Customer review — back to Send & track)
    await openUrl(page, url);
    await waitMounted(page, sink);
    const filled = await waitFor(async () => ((await composerValue(page, "Subject")) ?? "").includes(number) && ((await composerValue(page, "Body")) ?? "").includes("{link}"), 10_000);
    step("the composer is pre-filled (subject names the estimate, body carries {link})", filled, JSON.stringify({ subject: await composerValue(page, "Subject"), to: await composerValue(page, "To") }));
    // Before typing: a full-page screenshot resizes the viewport, which remounts the composer (its fields reset).
    await shot(page, "2-composer");
    // The slice's estimates carry no customer contact, so To starts blank — type one (the fields enable once settled).
    const toInput = () =>
      page.evaluateHandle(() => [...document.querySelectorAll('section[aria-label="Email the estimate"] label')].find((x) => x.querySelector("span")?.textContent?.trim() === "To")?.querySelector("input") ?? null);
    const toReady = await waitFor(() => page.evaluate(() => {
      const i = [...document.querySelectorAll('section[aria-label="Email the estimate"] label')].find((x) => x.querySelector("span")?.textContent?.trim() === "To")?.querySelector("input");
      return !!i && !i.disabled;
    }), 10_000);
    if (toReady && !(await composerValue(page, "To"))) {
      const el = (await toInput()).asElement() as import("puppeteer-core").ElementHandle<HTMLInputElement> | null;
      if (el) await el.type("client@example.com");
    }
    step("To holds a recipient", ((await composerValue(page, "To")) ?? "").includes("@"), String(await composerValue(page, "To")));
    const sendClicked = await waitFor(() => clickButton(page, "Send & mark sent →"), 5000);
    const sentUi = await waitFor(async () => (await statusValue(page)) === "sent" && (await activityText(page)).includes("Sent (simulated)"), 10_000);
    const s3 = await stored(page);
    const rows3 = await activityRows(page);
    const notice = await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Email the estimate"] [role="status"]')].map((x) => (x as HTMLElement).innerText).join(" | "));
    step("Send & mark sent → status Sent and the Activity card shows “Sent (simulated)”", sendClicked && sentUi, `clicked ${sendClicked}; status ${await statusValue(page)}; notice ${JSON.stringify(notice)}; activity ${JSON.stringify((await activityText(page)).slice(0, 200))}`);
    step("the store: status sent, a sent revision, one recorded estimate email, an email activity row", s3?.status === "sent" && s3.revisions?.at(-1)?.reason === "sent" && (s3.estimateEmails?.length ?? 0) === 1 && rows3.some((a) => a.kind === "email"),
      JSON.stringify({ status: s3?.status, rev: s3?.revisions?.at(-1)?.reason, emails: s3?.estimateEmails?.length, rows: rows3.map((a) => a.kind) }));
    await shot(page, "3-sent");
    await noteUnregistered(page);

    // 4 — a reload keeps it
    await openUrl(page, url);
    await waitMounted(page, sink);
    const kept = await waitFor(async () => (await statusValue(page)) === "sent" && (await activityText(page)).includes("Sent (simulated)"), 10_000);
    step("after a reload: still Sent, the Activity card still shows “Sent (simulated)”", kept);

    // 5 — Mark Won: the onWon port's note shows in the Activity
    await page.select("#est-send-status-select", "won");
    const won = await waitFor(async () => (await statusValue(page)) === "won" && (await activityText(page)).includes("Would create install project"), 10_000);
    const s5 = await stored(page);
    step("Mark Won → the Activity shows “Would create install project”", won && s5?.status === "won", `status ${s5?.status}; activity ${JSON.stringify((await activityText(page)).slice(0, 300))}`);
    await openUrl(page, url);
    await waitMounted(page, sink);
    step("after a reload: the Won note is still there", await waitFor(async () => (await activityText(page)).includes("Would create install project"), 10_000));
    await shot(page, "4-won");
    await noteUnregistered(page);
    await page.evaluate(async () => (window as unknown as EditH).__peakHandoff.store.reset());
    await page.evaluate((k) => localStorage.removeItem(k), CURRENT_USER_KEY);
    await page.close();
  } finally {
    await browser.close();
  }
  const unexpectedUnregistered = [...unexpected];
  const pass = steps.every((s) => s.ok) && unexpectedUnregistered.length === 0 && sink.pageErrors.length === 0 && sink.foreignRequests.length === 0 && sink.failedLocal.length === 0;
  return { pass, id: q.id, estimator: VERIFY_ESTIMATOR.name, manager: manager.name, steps, screenshots, unexpectedUnregistered, ...sink };
}

function printSend(r: SendResult): void {
  console.log(`handoff:verify --send  ${r.pass ? "PASS" : "FAIL"} (${r.id}; ${r.estimator} → ${r.manager})`);
  for (const s of r.steps) console.log(`  ${s.ok ? "ok  " : "FAIL"} ${s.step}${s.detail ? ` (${s.detail})` : ""}`);
  console.log(`  unexpected unregistered: ${r.unexpectedUnregistered.length}`);
  for (const x of r.unexpectedUnregistered) console.log(`    ${x}`);
  console.log(`  page errors: ${r.pageErrors.length}`);
  for (const e of r.pageErrors) console.log(`    ${e.split("\n").slice(0, 4).join("\n    ")}`);
  console.log(`  foreign requests: ${r.foreignRequests.length}; failed local files: ${r.failedLocal.length}`);
  for (const u of [...r.foreignRequests, ...r.failedLocal]) console.log(`    ${u}`);
  if (r.consoleErrors.length) {
    console.log(`  console errors (all but the benign ones are page errors too): ${r.consoleErrors.length}`);
    for (const e of r.consoleErrors.slice(0, 10)) console.log(`    ${e.slice(0, 200)}`);
  }
  console.log(`  screenshots: ${r.screenshots.map((f) => path.relative(ROOT, f)).join(", ")}`);
}

/* ------------------------------------------------------------------ --shell */

/** The URL of one estimate in the shell: the Estimator's own `?id=` (+ query) in the search, the route in the hash. */
export function estimateUrl(base: string, id: string, query = ""): string {
  return `${base}${base.includes("?") ? "&" : "?"}id=${encodeURIComponent(id)}${query ? "&" + query : ""}#/estimate/${encodeURIComponent(id)}`;
}
/** The URL of a clean new estimate. */
export const newEstimateUrl = (base: string): string => `${base}${base.includes("?") ? "&" : "?"}new=1#/estimate/new`;

/* ------------------------------------------------------------------ --serve */

const SERVE_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff",
};

/**
 * A tiny static server over the package — only the files the zip carries (package.ts zipEntries: no junk, no
 * images/manifest.json), as an Artifact or any web host would publish them — on 127.0.0.1 and a free port. Anything
 * else is a 404. Returns the origin and a close().
 */
export async function servePackage(pkgDir: string): Promise<{ origin: string; files: number; close: () => Promise<void> }> {
  const http = await import("node:http");
  const { zipEntries } = await import("./package");
  const shipped = new Set(zipEntries(pkgDir));
  const server = http.createServer((req, res) => {
    let rel = "";
    try {
      rel = decodeURIComponent(new URL(req.url ?? "/", "http://host").pathname).replace(/^\/+/, "") || "index.html";
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (!shipped.has(rel)) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not part of the package");
      return;
    }
    res.writeHead(200, { "content-type": SERVE_TYPES[path.extname(rel).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(path.join(pkgDir, rel)));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  const port = addr && typeof addr === "object" ? addr.port : 0;
  return { origin: `http://127.0.0.1:${port}`, files: shipped.size, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/**
 * --serve: the package over http (servePackage) instead of file:// — the Artifact path — with a host-style query
 * string on the page URL (`index.html?v=1`): --smoke --all-steps over every estimate, plus the fonts check (smoke's
 * readFonts, also with <html> stripped). The server's origin counts as local; any other host is foreign.
 */
export async function serveCheck(pkgDir: string): Promise<SmokeResult & { origin: string; servedFiles: number }> {
  const srv = await servePackage(pkgDir);
  servedOrigin = srv.origin;
  try {
    const r = await smoke(pkgDir, true, undefined, { baseUrl: `${srv.origin}/index.html?v=1` });
    return { ...r, origin: srv.origin, servedFiles: srv.files };
  } finally {
    servedOrigin = null;
    await srv.close();
  }
}

/* ------------------------------------------------------------------ --drift */

/**
 * --drift [--update [<port> …]]: the ported originals against port-sources.json (port-drift.ts). `update` false = check
 * only; [] = re-stamp every entry; names = re-stamp those ports only (an unknown name fails and writes nothing). Returns pass.
 */
function driftCheck(update: false | readonly string[]): boolean {
  const file = path.join(ROOT, PORT_SOURCES_FILE);
  const manifest = parsePortSources(JSON.parse(readFileSync(file, "utf8")));
  const hashOf = (p: string) => {
    const abs = path.join(ROOT, p);
    return existsSync(abs) ? sha256Of(readFileSync(abs)) : null;
  };
  const exists = (p: string) => existsSync(path.join(ROOT, p));
  if (update) {
    const unknown = unknownPorts(manifest, update);
    if (unknown.length) {
      console.log(`handoff:verify --drift --update  FAIL: not a port in ${PORT_SOURCES_FILE}: ${unknown.join(", ")} (nothing written)`);
      return false;
    }
    writeFileSync(file, JSON.stringify(updatedPortSources(manifest, hashOf, update.length ? update : undefined), null, 2) + "\n");
    console.log(`handoff:verify --drift --update  wrote ${PORT_SOURCES_FILE} (${update.length ? `re-stamped ${update.join(", ")}` : "re-stamped every entry"})`);
  }
  const now = update ? parsePortSources(JSON.parse(readFileSync(file, "utf8"))) : manifest;
  const r = driftOf(now, hashOf, exists);
  // completeness: every runtime module that says it ports a src/ module must be in the manifest
  const walk = (rel: string): string[] =>
    readdirSync(path.join(ROOT, rel)).sort().flatMap((n) => (statSync(path.join(ROOT, rel, n)).isDirectory() ? walk(`${rel}/${n}`) : [`${rel}/${n}`]));
  const scanned = walk(PORT_SCAN_DIR);
  const unlisted = unlistedPorts(now, scanned, (f) => readFileSync(path.join(ROOT, f), "utf8"));
  const ok = driftClean(r) && unlisted.length === 0;
  console.log(`handoff:verify --drift  ${ok ? "PASS" : "FAIL"} (${now.ports.length} ports, ${r.checked} originals; changed ${r.changed.length}, missing ${r.missing.length}, ports missing ${r.portsMissing.length}; ${scanned.length} runtime modules scanned, unlisted ports ${unlisted.length})`);
  for (const m of driftMessages(r)) console.log(`  ${m}`);
  for (const f of unlisted) console.log(`  ${f} says it ports a src/ module but has no entry in ${PORT_SOURCES_FILE} — add one (its originals), then \`--drift --update ${f}\``);
  return ok;
}

async function main() {
  const argv = process.argv.slice(2);
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const pkgDir = path.resolve(ROOT, val("--out") ?? "output/peak-estimator-handoff");
  const est = val("--estimator");
  const editAt = argv.indexOf("--estimator-edit");
  const edit = editAt >= 0 ? (argv[editAt + 1] && !argv[editAt + 1].startsWith("--") ? argv[editAt + 1] : "") : undefined;
  const reviewAt = argv.indexOf("--review");
  const review = reviewAt >= 0 ? (argv[reviewAt + 1] && !argv[reviewAt + 1].startsWith("--") ? argv[reviewAt + 1] : "") : undefined;
  const sendAt = argv.indexOf("--send");
  const send = sendAt >= 0 ? (argv[sendAt + 1] && !argv[sendAt + 1].startsWith("--") ? argv[sendAt + 1] : "") : undefined;
  const shell = argv.includes("--shell");
  const catalog = argv.includes("--catalog");
  const assemblies = argv.includes("--assemblies");
  const rules = argv.includes("--rules");
  const photos = argv.includes("--photos");
  const drift = argv.includes("--drift");
  const parity = argv.includes("--parity");
  const full = argv.includes("--full");
  const serve = argv.includes("--serve");
  const exportFiles = argv.flatMap((a, i) => (a === "--export" && argv[i + 1] && !argv[i + 1].startsWith("--") ? [path.resolve(argv[i + 1])] : []));
  if (!argv.includes("--smoke") && !est && edit === undefined && review === undefined && send === undefined && !shell && !catalog && !assemblies && !rules && !photos && !drift && !parity && !full && !serve) {
    console.error("usage: npm run handoff:verify -- --smoke [--all-steps] | --shell | --catalog | --assemblies | --rules | --photos | --estimator <quoteId|all> | --estimator-edit [quoteId] | --review [quoteId] | --send [quoteId] | --parity [--export <export.json> …] | --full [--allow-missing-features] [--out <package dir>] | --drift [--update [<port> …]] | --serve");
    process.exit(2);
  }
  mkdirSync(VERIFY_DIR, { recursive: true });
  let pass = true;
  if (drift) {
    // `--update` takes the port paths that follow it (up to the next --flag); none = every entry.
    const at = argv.indexOf("--update");
    const named: string[] = [];
    if (at >= 0) for (let i = at + 1; i < argv.length && !argv[i].startsWith("--"); i++) named.push(argv[i]);
    pass &&= driftCheck(at >= 0 ? named : false);
  }
  if (argv.includes("--smoke")) {
    const r = await smoke(pkgDir, argv.includes("--all-steps"));
    writeFileSync(path.join(VERIFY_DIR, "smoke.json"), JSON.stringify(r, null, 2) + "\n");
    printSmoke(r);
    pass &&= r.pass;
  }
  if (serve) {
    const r = await serveCheck(pkgDir);
    writeFileSync(path.join(VERIFY_DIR, "serve.json"), JSON.stringify(r, null, 2) + "\n");
    console.log(`handoff:verify --serve  ${r.pass ? "PASS" : "FAIL"} — ${r.servedFiles} package files served at ${r.origin} (index.html?v=1), --smoke --all-steps + fonts:`);
    printSmoke(r);
    pass &&= r.pass;
  }
  if (est) {
    const r = await estimatorCheck(pkgDir, est);
    writeFileSync(path.join(VERIFY_DIR, "estimator.json"), JSON.stringify(r, null, 2) + "\n");
    printEstimator(r);
    pass &&= r.pass;
  }
  if (edit !== undefined) {
    const r = await estimatorEditCheck(pkgDir, edit || undefined);
    writeFileSync(path.join(VERIFY_DIR, "estimator-edit.json"), JSON.stringify(r, null, 2) + "\n");
    printEdit(r);
    pass &&= r.pass;
  }
  if (review !== undefined) {
    const r = await reviewCheck(pkgDir, review || undefined);
    writeFileSync(path.join(VERIFY_DIR, "review.json"), JSON.stringify(r, null, 2) + "\n");
    printReview(r);
    pass &&= r.pass;
  }
  if (send !== undefined) {
    const r = await sendCheck(pkgDir, send || undefined);
    writeFileSync(path.join(VERIFY_DIR, "send.json"), JSON.stringify(r, null, 2) + "\n");
    printSend(r);
    pass &&= r.pass;
  }
  if (shell) {
    // verify/shell.ts imports this module's helpers; loaded here, once this module has finished evaluating.
    const { shellCheck, printShell } = await import("./verify/shell");
    const r = await shellCheck(pkgDir);
    writeFileSync(path.join(VERIFY_DIR, "shell.json"), JSON.stringify(r, null, 2) + "\n");
    printShell(r);
    pass &&= r.pass;
  }
  if (catalog) {
    // verify/catalog.ts imports this module's helpers; loaded here, once this module has finished evaluating.
    const { catalogCheck, printCatalog } = await import("./verify/catalog");
    const r = await catalogCheck(pkgDir);
    writeFileSync(path.join(VERIFY_DIR, "catalog.json"), JSON.stringify(r, null, 2) + "\n");
    printCatalog(r);
    pass &&= r.pass;
  }
  if (assemblies) {
    // verify/assemblies.ts imports this module's helpers; loaded here, once this module has finished evaluating.
    const { assembliesCheck, printAssemblies } = await import("./verify/assemblies");
    const r = await assembliesCheck(pkgDir);
    writeFileSync(path.join(VERIFY_DIR, "assemblies.json"), JSON.stringify(r, null, 2) + "\n");
    printAssemblies(r);
    pass &&= r.pass;
  }
  if (rules) {
    // verify/rules.ts imports this module's helpers; loaded here, once this module has finished evaluating.
    const { rulesCheck, printRules } = await import("./verify/rules");
    const r = await rulesCheck(pkgDir);
    writeFileSync(path.join(VERIFY_DIR, "rules.json"), JSON.stringify(r, null, 2) + "\n");
    printRules(r);
    pass &&= r.pass;
  }
  if (photos) {
    // verify/photos.ts imports this module's helpers; loaded here, once this module has finished evaluating.
    const { photosCheck, printPhotos } = await import("./verify/photos");
    const r = await photosCheck(pkgDir);
    writeFileSync(path.join(VERIFY_DIR, "photos.json"), JSON.stringify(r, null, 2) + "\n");
    printPhotos(r);
    pass &&= r.pass;
  }
  if (parity) {
    const { parityCheck, printParity } = await import("./verify/parity");
    const r = await parityCheck(pkgDir, exportFiles);
    writeFileSync(path.join(VERIFY_DIR, "parity.json"), JSON.stringify(r, null, 2) + "\n");
    printParity(r);
    pass &&= r.pass;
  }
  if (full) {
    // verify/full.ts imports this module's helpers; loaded here, once this module has finished evaluating.
    const { fullCheck, printFull } = await import("./verify/full");
    const r = await fullCheck(pkgDir, { allowMissingFeatures: argv.includes("--allow-missing-features") });
    writeFileSync(path.join(VERIFY_DIR, "full.json"), JSON.stringify(r, null, 2) + "\n");
    printFull(r);
    pass &&= r.pass;
  }
  if (!pass) process.exit(1);
}

if (/handoff[\\/]estimator[\\/]verify\.ts$/.test(path.resolve(process.argv[1] ?? ""))) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}

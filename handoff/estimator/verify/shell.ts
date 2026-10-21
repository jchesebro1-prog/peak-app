/**
 * Estimator handoff — `npm run handoff:verify -- --shell` (PR 2 Task 7): the app shell walk, in headless Chrome over the
 * built package. Split out of verify.ts (which loads it on demand and owns the shared page helpers). See verify.ts's
 * header for what --shell covers.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Dialog, Page } from "puppeteer-core";
import { SWITCH_UNSAVED_CONFIRM } from "../runtime/routes";
import { chromeLaunch } from "@/lib/quote-pdf/render";
import { fmt } from "@/lib/estimating-core/pricing";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { CURRENT_USER_KEY } from "../runtime/ports";
import {
  clickButton,
  estimateUrl,
  expectedEstimatorTotals,
  firstQtyInput,
  goldenGrand,
  loadSliceData,
  newPage,
  newSink,
  openUrl,
  pageHasText,
  readHeaderTotal,
  ROOT,
  sliceTeam,
  SMOKE_ALLOWED_UNREGISTERED,
  unregisteredOn,
  VERIFY_DIR,
  waitFor,
  waitMounted,
  type EditH,
  type PageSink,
  type SliceQuote,
} from "../verify";

/** The verify-only Reviewer-only persona the --shell walk switches to (no roster member holds Reviewer alone). */
export const VERIFY_REVIEWER = { id: "u-verify-rev", name: "Riley Verify", roles: ["Reviewer"], status: "active" } as const;

type ShellResult = { pass: boolean; rows: number; steps: Array<{ step: string; ok: boolean; detail?: string }>; screenshots: string[]; unexpectedUnregistered: string[] } & PageSink;

const shellLoc = (page: Page) =>
  page.evaluate(() => ({
    hash: location.hash,
    search: location.search,
    route: document.querySelector("[data-handoff-shell]")?.getAttribute("data-handoff-route") ?? null,
  }));

/** Waits for the Estimates list to show at least one row (or its empty state). */
const waitList = (page: Page) =>
  waitFor(() => page.evaluate(() => !!document.querySelector("[data-handoff-list]") && (document.querySelectorAll("tr[data-estimate-id]").length > 0 || !!document.querySelector("[data-handoff-list-empty]"))), 15_000);

const listRowIds = (page: Page) => page.evaluate(() => [...document.querySelectorAll("tr[data-estimate-id]")].map((r) => r.getAttribute("data-estimate-id") as string));
const cellText = (page: Page, id: string, col: string) =>
  page.evaluate((i, c) => (document.querySelector(`tr[data-estimate-id="${i}"] td[data-col="${c}"]`) as HTMLElement | null)?.innerText.trim() ?? null, id, col);
const hasEstimator = (page: Page) => page.evaluate(() => !!document.querySelector(".est-root"));
const histLen = (page: Page) => page.evaluate(() => history.length);
/** Tags the mounted Estimator root; `rootMark` reads it back — the same value means no remount happened. */
const markRoot = (page: Page, v: number) =>
  page.evaluate((n) => {
    const el = document.querySelector(".est-root") as unknown as { __mark?: number } | null;
    if (el) el.__mark = n;
  }, v);
const rootMark = (page: Page) => page.evaluate(() => (document.querySelector(".est-root") as unknown as { __mark?: number } | null)?.__mark ?? null);
const params = (search: string) => new URLSearchParams(search);
/** A real (puppeteer mouse) click on the first visible element matching `selector` whose text starts with `text`. */
async function clickVisible(page: Page, selector: string, text: string): Promise<boolean> {
  const h = await page.evaluateHandle(
    (sel, t) => [...document.querySelectorAll(sel)].find((e) => (e.textContent ?? "").trim().startsWith(t) && (e as HTMLElement).offsetParent !== null) ?? null,
    selector,
    text,
  );
  const el = h.asElement() as import("puppeteer-core").ElementHandle<Element> | null;
  if (!el) return false;
  await el.click();
  return true;
}
/** True once the in-page anchor `#id` was scrolled to: at the top of its scroll container, or that container scrolled to its end. */
const anchorAtTop = (page: Page, id: string) =>
  page.evaluate((i) => {
    const el = document.getElementById(i);
    if (!el || !el.getClientRects().length) return false;
    let sc: HTMLElement | null = el.parentElement;
    while (sc && !(sc.scrollHeight > sc.clientHeight && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    const top = el.getBoundingClientRect().top - (sc ? sc.getBoundingClientRect().top : 0);
    // At the top — or the container scrolled as far as it goes (the section sits near the end of the tab).
    const atEnd = !!sc && sc.scrollTop > 0 && sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 2;
    return top > -4 && (top < 80 || atEnd) && (sc ? sc.scrollTop > 0 : true);
  }, id);

/**
 * Task 7 — the shell: the Estimates list (N rows, the first row's total = the Estimator's header total = the golden
 * grand), opening a row lands on Build and Back returns to the list, the nav, router.push / link-click routing of
 * app paths, the user switcher (a Reviewer-only member hides "New estimate"), a new estimate keeping its screen
 * through the first save's id, Reset to production snapshot restoring an edited quantity, and the not-persistent notice.
 */
export async function shellCheck(pkgDir: string): Promise<ShellResult> {
  const index = path.join(pkgDir, "index.html");
  if (!existsSync(index)) throw new Error(`${index} not found — run npm run handoff:build first`);
  const data = loadSliceData(pkgDir);
  const system = data.estimates.filter((q) => (q.quoteType ?? "system") === "system");
  if (system.length < 2) throw new Error("the slice needs at least two system estimates for --shell");
  const first = [...system].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0) || (a.id < b.id ? -1 : 1))[0];
  const expectedFirst = expectedEstimatorTotals(first, data.rules);
  // The package's own golden file for the first row (handoff:build writes one per sliced estimate); else the repo's.
  const pkgGolden = path.join(pkgDir, "spec", "golden", `${first.id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
  const golden = existsSync(pkgGolden)
    ? (() => { const g = (JSON.parse(readFileSync(pkgGolden, "utf8")) as { totals?: { grand?: number } }).totals?.grand; return typeof g === "number" ? { grand: g, file: pkgGolden } : null; })()
    : goldenGrand(first.id);
  const drafts = system.filter((q) => (q.status ?? "draft") === "draft").length;
  const second = system.find((q) => q.id !== first.id) as SliceQuote;
  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new Error(launch.unavailable);
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: launch.executablePath, args: launch.args, headless: true, defaultViewport: { width: 1440, height: 900 } });
  const sink = newSink();
  const steps: ShellResult["steps"] = [];
  const step = (name: string, ok: boolean, detail?: string) => steps.push({ step: name, ok, ...(detail ? { detail } : {}) });
  const screenshots: string[] = [];
  const shot = async (page: Page, name: string) => {
    const file = path.join(VERIFY_DIR, `shell-${name}.png`);
    await page.screenshot({ path: file as `${string}.png` });
    screenshots.push(file);
  };
  const allowed = new Set(SMOKE_ALLOWED_UNREGISTERED);
  const unexpected = new Set<string>();
  const noteUnregistered = async (page: Page) => (await unregisteredOn(page)).filter((x) => !allowed.has(x)).forEach((x) => unexpected.add(x));
  const base = pathToFileURL(index).href;
  const rosterInject = `(() => {
    let team;
    const extra = ${JSON.stringify(VERIFY_REVIEWER)};
    Object.defineProperty(window, "PEAK_TEAM", {
      configurable: true,
      get: () => team,
      set: (v) => { team = Array.isArray(v) ? v.filter((u) => u && u.id !== extra.id).concat([extra]) : v; },
    });
  })();`;
  const push = (page: Page, href: string) => page.evaluate((h) => (window as unknown as { __peakHandoff: { router: { push(h: string): void } } }).__peakHandoff.router.push(h), href);
  const clickLink = (page: Page, href: string) =>
    page.evaluate((h) => {
      const a = document.createElement("a");
      a.setAttribute("href", h);
      a.textContent = "x";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, href);
  const noticeText = (page: Page) => page.evaluate(() => (document.querySelector("[data-handoff-notice]") as HTMLElement | null)?.innerText ?? "");
  const goBack = async (page: Page) => {
    await page.goBack();
    return waitFor(async () => (await shellLoc(page)).route !== null, 5000);
  };
  try {
    mkdirSync(VERIFY_DIR, { recursive: true });
    const page = await newPage(browser, sink);
    await page.evaluateOnNewDocument(rosterInject);
    // A clean overlay: this profile is fresh, but reset anyway so a rerun never builds on old edits.
    await openUrl(page, base);
    await page.waitForSelector("[data-handoff-ready]", { timeout: 15_000 });
    await page.evaluate(async () => (window as unknown as EditH).__peakHandoff.store.reset());
    await openUrl(page, base);

    // 1 — the default screen is the Estimates list
    step("a bare index.html boots on the Estimates list", await waitList(page));
    const loc0 = await shellLoc(page);
    step("…at #/estimates", loc0.hash === "#/estimates" && loc0.route === "estimates", JSON.stringify(loc0));
    const banner = await page.evaluate(() => (document.querySelector("[data-handoff-banner]") as HTMLElement | null)?.innerText ?? "");
    step("the permanent banner reads “Confidential — Peak Systems Group · prototype — nothing is sent or saved to Peak”", banner.includes("Confidential — Peak Systems Group · prototype — nothing is sent or saved to Peak"), banner);
    step("…and no not-persistent notice while IndexedDB works", !(await page.evaluate(() => !!document.querySelector("[data-handoff-not-persistent]"))));
    const navLabels = await page.evaluate(() => [...document.querySelectorAll("[data-handoff-nav]")].map((a) => (a as HTMLElement).innerText.trim()));
    step("the nav reads Estimates · Catalog · Assemblies · Estimating Rules", navLabels.join(" · ") === "Estimates · Catalog · Assemblies · Estimating Rules", navLabels.join(" · "));

    // 2 — N rows, the first row's total
    const ids = await listRowIds(page);
    step(`the list shows the slice's ${system.length} system estimates`, ids.length === system.length && system.every((q) => ids.includes(q.id)), ids.join(","));
    step(`newest first: ${first.id} leads`, ids[0] === first.id, ids.join(","));
    const total0 = await cellText(page, first.id, "total");
    step("the first row's total is the Estimator's grand total for it", total0 === fmt(expectedFirst.canonical), `${total0} vs ${fmt(expectedFirst.canonical)}`);
    // The golden grand is the engine over the STORED sections (totals()); the list shows the post-load total, which differs
    // only by the load canonicalization (the $25 round-up, derived bonus lines — pricing.md §12). So: golden = raw, always;
    // and list = golden exactly when no canonicalization applies.
    const canon = expectedFirst.priceRound || expectedFirst.bonusLines;
    step("…the golden grand is totals() of the stored sections, and the list total equals it when no load canonicalization applies",
      !!golden && fmt(golden.grand) === fmt(expectedFirst.raw) && (canon || total0 === fmt(golden.grand)),
      `golden ${golden ? fmt(golden.grand) : "none"}; raw ${fmt(expectedFirst.raw)}; list ${total0}${canon ? " (load canonicalization applies)" : ""}`);
    const allTotals = await Promise.all(system.map(async (q) => [q.id, await cellText(page, q.id, "total"), fmt(expectedEstimatorTotals(q, data.rules).canonical)] as const));
    step("every row's total is its estimate's canonical grand total", allTotals.every(([, shown, want]) => shown === want), allTotals.map(([id, shown, want]) => `${id} ${shown}${shown === want ? "" : ` ≠ ${want}`}`).join("; "));
    step("the number column is displayQuoteNumber", (await cellText(page, first.id, "number")) === displayQuoteNumber({ ...first, id: first.id }));
    const cols = await page.evaluate(() => [...document.querySelectorAll("thead th")].map((t) => (t.textContent ?? "").trim()));
    step("columns: Estimate # · Name · Customer · Status · Owner · Updated · Total", cols.join(" | ") === "Estimate # | Name | Customer | Status | Owner | Updated | Total", cols.join(" | "));
    await shot(page, "1-list");

    // 3 — search + status filter
    const target = system[system.length - 1];
    await page.type("input[data-handoff-list-search]", displayQuoteNumber({ ...target, id: target.id }));
    const searched = await listRowIds(page);
    step("searching an estimate number narrows the list to it", searched.includes(target.id) && searched.length < ids.length + 1 && searched.length >= 1, searched.join(","));
    await page.click("input[data-handoff-list-search]", { count: 3 });
    await page.keyboard.press("Backspace");
    step("clearing the search restores every row", (await listRowIds(page)).length === system.length);
    await page.click('button[data-handoff-list-filter="draft"]');
    const draftIds = await listRowIds(page);
    step(`the Draft filter shows the ${drafts} draft estimates`, draftIds.length === drafts, draftIds.join(","));
    await page.click('button[data-handoff-list-filter="all"]');

    // 4 — open a row → Build; Back → the list
    await page.click(`tr[data-estimate-id="${first.id}"] td[data-col="name"] a`);
    step("opening a row mounts the Estimator", await waitFor(() => hasEstimator(page), 15_000));
    const loc1 = await shellLoc(page);
    step(`…at #/estimate/${first.id} with ?id= in the search and no ?step= (Build)`, loc1.hash === `#/estimate/${first.id}` && new URLSearchParams(loc1.search).get("id") === first.id && !new URLSearchParams(loc1.search).has("step"), JSON.stringify(loc1));
    await new Promise((r) => setTimeout(r, 1200));
    const header1 = await readHeaderTotal(page);
    step("the Estimator's header total equals the list's", header1 === total0, `${header1} vs ${total0}`);
    await shot(page, "2-estimate");
    await noteUnregistered(page);
    step("the browser Back button returns to the list", (await goBack(page)) && (await waitList(page)) && (await shellLoc(page)).hash === "#/estimates" && !(await hasEstimator(page)));
    step("…once (the click made one history entry, not two)", (await listRowIds(page)).length === system.length);
    await page.goForward();
    step("Forward reopens the estimate", await waitFor(() => hasEstimator(page), 15_000));
    await goBack(page);
    await waitList(page);
    await page.click(`tr[data-estimate-id="${first.id}"] td[data-col="customer"]`);
    step("clicking the row (not the link) opens it too", await waitFor(() => hasEstimator(page), 15_000));
    step("…and one Back returns to the list", (await goBack(page)) && (await waitList(page)));

    // 5 — the nav
    for (const [nav, label] of [["catalog", "Catalog"], ["assemblies", "Assemblies"], ["rules", "Estimating Rules"]] as const) {
      await page.click(`[data-handoff-nav="${nav}"]`);
      // Catalog is a real screen since Task 8 (walked by --catalog), Assemblies since Task 9 (--assemblies), Estimating Rules since Task 10 (--rules).
      if (nav === "catalog") {
        const ok = await waitFor(async () => (await shellLoc(page)).hash === "#/catalog" && (await page.evaluate(() => !!document.querySelector("[data-handoff-catalog] [data-catalog-rows] tr"))), 8000);
        step(`nav → ${label}: #/${nav}, the Catalog screen`, ok && !(await page.evaluate(() => !!document.querySelector("[data-handoff-placeholder]"))));
        continue;
      }
      if (nav === "assemblies") {
        const ok = await waitFor(async () => (await shellLoc(page)).hash === "#/assemblies" && (await page.evaluate(() => !!document.querySelector("[data-handoff-assemblies]"))), 8000);
        step(`nav → ${label}: #/${nav}, the Assembly Builder`, ok && !(await page.evaluate(() => !!document.querySelector("[data-handoff-placeholder]"))));
        continue;
      }
      const ok = await waitFor(async () => (await shellLoc(page)).hash === `#/${nav}` && (await page.evaluate(() => !!document.querySelector("[data-handoff-rules]"))), 8000);
      step(`nav → ${label}: #/${nav}, the Estimating Rules editor`, ok && (await pageHasText(page, "Estimating rules")));
    }
    await shot(page, "3-rules");
    await page.click('[data-handoff-nav="estimates"]');
    step("nav → Estimates: the list again", (await waitList(page)) && (await shellLoc(page)).hash === "#/estimates");
    await page.evaluate(() => {
      location.hash = "#/zzz";
    });
    step("an unknown hash route shows “Not part of the prototype”", await waitFor(() => page.evaluate(() => !!document.querySelector("[data-handoff-unknown]")), 5000));
    await page.click("[data-handoff-unknown] a");
    step("…with a way back to the list", (await waitList(page)) && (await shellLoc(page)).hash === "#/estimates");

    // 6 — router.push / link-click mapping, from an open estimate
    await openUrl(page, estimateUrl(base, first.id));
    await waitMounted(page, sink);
    await page.evaluate(() => {
      (document.querySelector(".est-root") as unknown as { __mark?: number }).__mark = 1;
    });
    await push(page, `/estimator?id=${encodeURIComponent(second.id)}`);
    const swapped = await waitFor(async () => (await shellLoc(page)).hash === `#/estimate/${second.id}` && (await pageHasText(page, displayQuoteNumber({ ...second, id: second.id }))), 10_000);
    const loc2 = await shellLoc(page);
    step("router.push(/estimator?id=B) → #/estimate/B, the Estimator remounted on B", swapped && new URLSearchParams(loc2.search).get("id") === second.id, JSON.stringify(loc2));
    await new Promise((r) => setTimeout(r, 1000));
    await page.evaluate(() => {
      (document.querySelector(".est-root") as unknown as { __mark?: number }).__mark = 1;
    });
    await push(page, "/estimator?step=review");
    await new Promise((r) => setTimeout(r, 600));
    const loc3 = await shellLoc(page);
    const marked = await page.evaluate(() => (document.querySelector(".est-root") as unknown as { __mark?: number }).__mark === 1);
    step("router.push(/estimator?step=review) stays on the page (route kept, no remount)", loc3.hash === `#/estimate/${second.id}` && new URLSearchParams(loc3.search).get("step") === "review" && marked, JSON.stringify(loc3));
    await page.evaluate(() => history.pushState(null, "", location.pathname + location.search + "#systems"));
    const loc4 = await shellLoc(page);
    step("an in-page anchor push (#systems) keeps the route hash", loc4.hash === `#/estimate/${second.id}` && loc4.route === "estimate", JSON.stringify(loc4));
    for (const [from, hash] of [["/quotes", "#/estimates"], ["/catalog", "#/catalog"], ["/design/assemblies", "#/assemblies"], ["/design/assemblies/rack/SA-1", "#/assemblies/rack/SA-1"], ["/estimating-rules", "#/rules"]] as const) {
      await push(page, from);
      step(`router.push(${from}) → ${hash}`, await waitFor(async () => (await shellLoc(page)).hash === hash, 5000));
    }
    await push(page, "/design/grid/G-1");
    const notice = await waitFor(async () => (await noticeText(page)).includes("Not part of the prototype"), 3000);
    step("router.push(/design/grid/…) shows the “Not part of the prototype” notice and stays put", notice && (await shellLoc(page)).hash === "#/rules", await noticeText(page));
    await clickLink(page, "/quotes");
    step("clicking an <a href=\"/quotes\"> routes to the list", await waitFor(async () => (await shellLoc(page)).hash === "#/estimates", 5000) && (await waitList(page)));
    await clickLink(page, `/estimator?id=${encodeURIComponent(first.id)}`);
    step("clicking an <a href=\"/estimator?id=…\"> opens that estimate", await waitFor(async () => (await shellLoc(page)).hash === `#/estimate/${first.id}` && (await hasEstimator(page)), 10_000));
    await noteUnregistered(page);

    // 6b — one history entry per in-app link; Back / Forward between an estimate's steps and tabs (no remount)
    const linkQ = system.find((q) => q.id === "Q-G001") ?? first;
    await openUrl(page, estimateUrl(base, linkQ.id, "step=package"));
    await waitMounted(page, sink);
    await markRoot(page, 11);
    const h0 = await histLen(page);
    const narrClicked = await clickVisible(page, "a", "Change in Client package");
    const h1 = await histLen(page);
    const locN = await shellLoc(page);
    step(`Narrative → “Change in Client package →” adds exactly one history entry (${h0} → ${h1})`, narrClicked && h1 === h0 + 1 && params(locN.search).get("ptab") === "client" && locN.hash === `#/estimate/${linkQ.id}`, JSON.stringify(locN));
    step("…and scrolls to the Client package's Systems section (#systems)", await waitFor(() => anchorAtTop(page, "systems"), 6000));
    await page.goBack();
    const backN = await waitFor(async () => {
      const l = await shellLoc(page);
      return params(l.search).get("step") === "package" && !params(l.search).has("ptab");
    }, 5000);
    step("one Back returns to the Narrative tab — same Estimator, no remount", backN && (await rootMark(page)) === 11 && (await histLen(page)) === h1 && (await pageHasText(page, "Change in Client package")), JSON.stringify(await shellLoc(page)));
    await page.goForward();
    const fwdN = await waitFor(async () => params((await shellLoc(page)).search).get("ptab") === "client", 5000);
    step("Forward returns to the Client package tab — no remount", fwdN && (await rootMark(page)) === 11);

    await openUrl(page, estimateUrl(base, linkQ.id));
    await waitMounted(page, sink);
    await markRoot(page, 12);
    // The Build card's chip sits in the card's expanded footer: expand the first card when it isn't showing.
    if (!(await page.evaluate(() => !![...document.querySelectorAll('[data-testid="card-presentation"]')].find((e) => (e as HTMLElement).offsetParent !== null)))) {
      await page.evaluate(() => (document.querySelector("input.est-secname")?.closest("[class]") as HTMLElement | null)?.click());
      await waitFor(() => page.evaluate(() => !![...document.querySelectorAll('[data-testid="card-presentation"]')].find((e) => (e as HTMLElement).offsetParent !== null)), 3000);
    }
    const h2 = await histLen(page);
    const chipClicked = await clickVisible(page, '[data-testid="card-presentation"]', "Customer:");
    const h3 = await histLen(page);
    const locC = await shellLoc(page);
    step(`Build card “Customer: … ↗” adds exactly one history entry (${h2} → ${h3})`, chipClicked && h3 === h2 + 1 && params(locC.search).get("step") === "package" && params(locC.search).get("ptab") === "client", JSON.stringify(locC));
    await page.goBack();
    const backC = await waitFor(async () => !params((await shellLoc(page)).search).has("step"), 5000);
    step("one Back returns to Build — same Estimator, no remount", backC && (await rootMark(page)) === 12 && (await shellLoc(page)).hash === `#/estimate/${linkQ.id}`);
    await page.goForward();
    step("Forward returns to Build package → Client package — no remount", (await waitFor(async () => params((await shellLoc(page)).search).get("ptab") === "client", 5000)) && (await rootMark(page)) === 12);

    // 6c — a target="_blank" app path (Client package → Cover PDF "Download") stays in the window: the notice, no new page
    const pagesBefore = (await browser.pages()).length;
    const hashBefore = (await shellLoc(page)).hash;
    const hBefore = await histLen(page);
    await page.evaluate(() => document.querySelector("[data-handoff-notice]")?.remove());
    const coverClicked = await clickVisible(page, 'a[href*="/cover-pdf"]', "Download");
    const coverNotice = await waitFor(async () => (await noticeText(page)).includes("Not part of the prototype"), 3000);
    await new Promise((r) => setTimeout(r, 500));
    step("Cover PDF “Download” (target=_blank) shows “Not part of the prototype” and opens no new page", coverClicked && coverNotice && (await browser.pages()).length === pagesBefore && (await shellLoc(page)).hash === hashBefore && (await histLen(page)) === hBefore, `${await noticeText(page)}; pages ${pagesBefore} → ${(await browser.pages()).length}`);

    // 6c' — ctrl-click and middle-click on an app link never open a dead tab: a mapped path opens its #/ route in a new
    // tab of this package; an unmapped one shows the notice; a preview route opens the in-window overlay.
    {
      const prefix = base.split("#")[0].split("?")[0];
      const probe = async (href: string, how: "ctrl" | "middle") => {
        const hashB = (await shellLoc(page)).hash;
        const hB = await histLen(page);
        const before = new Set(await browser.pages());
        // Notices are read off the shell's own event (removing the React-owned element would leave a stale fiber).
        await page.evaluate(() => {
          const w = window as unknown as { __notices?: string[] };
          if (!w.__notices) {
            w.__notices = [];
            window.addEventListener("peak-handoff-notice", (e) => w.__notices!.push(String((e as CustomEvent).detail)));
          }
          w.__notices.length = 0;
        });
        await page.evaluate((h) => {
          document.getElementById("__probe")?.remove();
          const a = document.createElement("a");
          a.id = "__probe";
          a.setAttribute("href", h);
          a.textContent = "probe";
          a.setAttribute("style", "position:fixed;left:8px;top:8px;z-index:2147483647;padding:10px 16px;background:#fff;color:#000");
          document.body.appendChild(a);
        }, href);
        const box = await (await page.$("#__probe"))?.boundingBox();
        if (box) {
          const x = box.x + box.width / 2;
          const y = box.y + box.height / 2;
          if (how === "ctrl") {
            // Ctrl-click is a context-menu gesture on macOS: use the platform's open-in-new-tab modifier.
            const key = process.platform === "darwin" ? "Meta" : "Control";
            await page.keyboard.down(key);
            await page.mouse.click(x, y);
            await page.keyboard.up(key);
          } else await page.mouse.click(x, y, { button: "middle" });
        }
        await new Promise((r) => setTimeout(r, 900));
        const fresh = (await browser.pages()).filter((p) => !before.has(p));
        const urls = fresh.map((p) => p.url());
        // A new tab loads asynchronously: give it a moment to leave about:blank.
        if (urls.some((u) => u === "" || u === "about:blank")) await new Promise((r) => setTimeout(r, 1200));
        const final = fresh.map((p) => p.url());
        const notice = (await page.evaluate(() => (window as unknown as { __notices: string[] }).__notices)).some((t) => t.includes("Not part of the prototype"));
        const stayed = (await shellLoc(page)).hash === hashB && (await histLen(page)) === hB;
        for (const p of fresh) await p.close().catch(() => {});
        await page.evaluate(() => document.getElementById("__probe")?.remove());
        const overlay = await page.evaluate(() => !!document.querySelector("[data-handoff-overlay]"));
        return { urls: final, notice, stayed, box: !!box, overlay };
      };
      const live = (urls: string[], route: string) => urls.length === 1 && urls[0].startsWith(prefix) && urls[0].includes("#/") && urls[0].includes(route);
      for (const how of ["ctrl", "middle"] as const) {
        const label = how === "ctrl" ? "⌘/ctrl-click" : "middle-click";
        const mapped = await probe("/quotes", how);
        step(`${label} on <a href="/quotes"> opens the list's #/estimates route in a new tab inside the package (no dead page)`, mapped.box && live(mapped.urls, "#/estimates") && mapped.stayed, JSON.stringify(mapped));
        const est = await probe(`/estimator?id=${encodeURIComponent(first.id)}`, how);
        step(`${label} on <a href="/estimator?id=…"> opens #/estimate/<id> in a new tab inside the package`, est.box && live(est.urls, `#/estimate/${first.id}`) && est.stayed, JSON.stringify(est));
        const unmapped = await probe("/design/grid/G-1", how);
        step(`${label} on an unmapped app path (/design/grid/…) shows “Not part of the prototype” and opens no tab`, unmapped.box && unmapped.notice && unmapped.urls.length === 0 && unmapped.stayed, JSON.stringify(unmapped));
        const prev = await probe("/estimator-preview/Q-G001?tab=bom", how);
        step(`${label} on a preview route opens no tab — the in-window overlay shows`, prev.box && prev.urls.length === 0 && prev.stayed && prev.overlay, JSON.stringify(prev));
        await page.keyboard.press("Escape");
        await waitFor(() => page.evaluate(() => !document.querySelector("[data-handoff-overlay]")), 3000);
      }
      await noteUnregistered(page);
    }

    // 6d — a host's own query param survives the shell's navigations
    await openUrl(page, `${base}?v=42#/estimates`);
    await waitList(page);
    await page.click(`tr[data-estimate-id="${first.id}"] td[data-col="customer"]`);
    await waitFor(() => hasEstimator(page), 15_000);
    const locV1 = await shellLoc(page);
    await page.click('[data-handoff-nav="catalog"]');
    await waitFor(async () => (await shellLoc(page)).hash === "#/catalog", 5000);
    const locV2 = await shellLoc(page);
    await goBack(page);
    await waitFor(() => hasEstimator(page), 15_000);
    const locV3 = await shellLoc(page);
    step("a host's ?v= param survives list → estimate → catalog → Back", [locV1, locV2, locV3].every((l) => params(l.search).get("v") === "42") && params(locV1.search).get("id") === first.id && !params(locV2.search).has("id"), [locV1, locV2, locV3].map((l) => l.search + l.hash).join(" · "));

    // 7a — switching who you act as while the open estimate has unsaved edits asks first (the Estimator's unsaved hold)
    await openUrl(page, estimateUrl(base, first.id));
    await waitMounted(page, sink);
    const holdQty = await firstQtyInput(page);
    if (holdQty) {
      const q0 = Number(await holdQty.evaluate((i) => i.value));
      await holdQty.click({ count: 3 });
      await holdQty.type(String(q0 + 1));
      await page.keyboard.press("Tab");
      await new Promise((r) => setTimeout(r, 400));
      const who0 = await page.evaluate(() => (document.querySelector("select[data-handoff-user]") as HTMLSelectElement).value);
      const other = sliceTeam(pkgDir).find((u) => (u.status ?? "active") === "active" && u.id !== who0)?.id ?? VERIFY_REVIEWER.id;
      let asked = "";
      const onDialog = (d: Dialog) => { asked = d.message(); void d.dismiss(); };
      page.once("dialog", onDialog);
      await page.select("select[data-handoff-user]", other);
      await new Promise((r) => setTimeout(r, 400));
      const who1 = await page.evaluate(() => (document.querySelector("select[data-handoff-user]") as HTMLSelectElement).value);
      const qtyKept = await firstQtyInput(page);
      const q1 = qtyKept ? Number(await qtyKept.evaluate((i) => i.value)) : NaN;
      step("switching “Acting as” with unsaved edits asks first; Cancel keeps the person and the edit", asked === SWITCH_UNSAVED_CONFIRM && who1 === who0 && q1 === q0 + 1, `asked "${asked.slice(0, 40)}…"; ${who1} vs ${who0}; qty ${q1} vs ${q0 + 1}`);
      page.off("dialog", onDialog);
    } else step("an estimate line to edit for the unsaved-switch check", false, "no quantity input");

    // 7 — the user switcher
    await openUrl(page, base);
    await waitList(page);
    const options = await page.evaluate(() => [...document.querySelectorAll("select[data-handoff-user] option")].map((o) => (o as HTMLOptionElement).value));
    const roster = sliceTeam(pkgDir).filter((u) => (u.status ?? "active") === "active").map((u) => u.id);
    step("the switcher lists the active roster", roster.every((id) => options.includes(id)) && options.includes(VERIFY_REVIEWER.id), `${options.length} options`);
    step("an Admin sees “New estimate”", await page.evaluate(() => !!document.querySelector("[data-handoff-new-estimate]")));
    await page.select("select[data-handoff-user]", VERIFY_REVIEWER.id);
    step("switching to a Reviewer hides “New estimate”", await waitFor(() => page.evaluate(() => !document.querySelector("[data-handoff-new-estimate]")), 3000));
    step("…and the list is still there", (await listRowIds(page)).length === system.length);
    await openUrl(page, base);
    await waitList(page);
    step("the pick survives a reload (localStorage)", (await page.evaluate(() => (document.querySelector("select[data-handoff-user]") as HTMLSelectElement).value)) === VERIFY_REVIEWER.id && (await page.evaluate((k) => localStorage.getItem(k), CURRENT_USER_KEY)) === VERIFY_REVIEWER.id);
    await page.evaluate(() => {
      location.hash = "#/estimate/new";
    });
    step("a Reviewer opening #/estimate/new is told their role can't create", await waitFor(() => page.evaluate(() => !!document.querySelector("[data-handoff-refused]")), 5000));
    await page.select("select[data-handoff-user]", roster[0]);
    step("switching back to an Admin opens the new estimate", await waitFor(() => hasEstimator(page), 15_000));
    await goBack(page);
    await waitList(page);
    step("…the Admin sees “New estimate” again", await page.evaluate(() => !!document.querySelector("[data-handoff-new-estimate]")));

    // 8 — New estimate: its screen survives the first save's id
    await page.click("[data-handoff-new-estimate]");
    step("New estimate opens a clean estimate at #/estimate/new", (await waitFor(() => hasEstimator(page), 15_000)) && (await shellLoc(page)).hash === "#/estimate/new" && new URLSearchParams((await shellLoc(page)).search).get("new") === "1");
    await new Promise((r) => setTimeout(r, 1200));
    await page.evaluate(() => {
      (document.querySelector(".est-root") as unknown as { __mark?: number }).__mark = 7;
    });
    const hasSystem = await page.evaluate(() => !!document.querySelector("input.est-secname"));
    if (!hasSystem) {
      await clickButton(page, "+ Add system");
      await waitFor(() => pageHasText(page, "Blank system"), 3000);
      await clickButton(page, "Blank system", true);
    }
    await waitFor(() => page.evaluate(() => !!document.querySelector("input.est-secname")), 3000);
    // A step change before the first save: this entry (and the one before it) still name #/estimate/new.
    const hNew = await histLen(page);
    await page.click('nav[aria-label="Estimate steps"] button:nth-child(2)');
    await waitFor(async () => params((await shellLoc(page)).search).get("step") === "package", 5000);
    step("Build package before the first save: one new entry, still #/estimate/new", (await histLen(page)) === hNew + 1 && (await shellLoc(page)).hash === "#/estimate/new");
    await clickButton(page, "Save");
    step("Save shows Saved ✓", await waitFor(() => pageHasText(page, "Saved ✓"), 10_000));
    const moved = await waitFor(async () => /^#\/estimate\/Q-\d+$/.test((await shellLoc(page)).hash), 5000);
    const loc5 = await shellLoc(page);
    const newId = loc5.hash.replace("#/estimate/", "");
    step("the first save moves the route to the new id (#/estimate/Q-…, ?id= to match)", moved && params(loc5.search).get("id") === newId, JSON.stringify(loc5));
    const sameScreen = await page.evaluate(() => (document.querySelector(".est-root") as unknown as { __mark?: number }).__mark === 7);
    step("…without remounting the Estimator (unsaved state is kept)", sameScreen);
    await page.goBack();
    const backBuild = await waitFor(async () => {
      const l = await shellLoc(page);
      return l.hash === `#/estimate/${newId}` && params(l.search).get("id") === newId && !params(l.search).has("step") && !params(l.search).has("new");
    }, 5000);
    step("Back from the saved estimate to its pre-save Build entry: the SAVED estimate (re-pointed), not a blank new one — no remount", backBuild && (await rootMark(page)) === 7 && (await page.evaluate(() => !!document.querySelector("input.est-secname"))), JSON.stringify(await shellLoc(page)));
    await page.goForward();
    step("Forward returns to Build package on the saved estimate — no remount", (await waitFor(async () => params((await shellLoc(page)).search).get("step") === "package", 5000)) && (await rootMark(page)) === 7 && (await shellLoc(page)).hash === `#/estimate/${newId}`);
    await goBack(page);
    await goBack(page);
    step("two Backs from Build package return to the list", (await waitList(page)) && (await shellLoc(page)).hash === "#/estimates");
    step("the list now has the new estimate", (await listRowIds(page)).length === system.length + 1);

    // 9 — Reset to production snapshot restores an edited quantity
    const url = estimateUrl(base, first.id);
    await openUrl(page, url);
    await waitMounted(page, sink);
    const qtyEl = await firstQtyInput(page);
    const qty0 = qtyEl ? Number(await qtyEl.evaluate((i) => i.value)) : NaN;
    const totalSeed = await readHeaderTotal(page);
    if (qtyEl) {
      await qtyEl.click({ count: 3 });
      await qtyEl.type(String(qty0 + 1));
      await page.keyboard.press("Tab");
    }
    await waitFor(async () => (await readHeaderTotal(page)) !== totalSeed, 5000);
    await clickButton(page, "Save");
    step("an edited quantity saves (qty +1)", await waitFor(() => pageHasText(page, "Saved ✓"), 10_000), `${qty0} → ${qty0 + 1}`);
    await openUrl(page, url);
    await waitMounted(page, sink);
    const qtyEdited = await firstQtyInput(page);
    step("…and survives a reload", !!qtyEdited && Number(await qtyEdited.evaluate((i) => i.value)) === qty0 + 1);
    await page.click("[data-handoff-reset]");
    step("Reset opens a confirm dialog", await waitFor(() => page.evaluate(() => !!document.querySelector("[data-handoff-reset-dialog]")), 3000));
    const focusIs = (sel: string) => page.evaluate((x) => document.activeElement === document.querySelector(x), sel);
    step("…focus starts on its primary control (Reset)", await waitFor(() => focusIs("[data-handoff-reset-confirm]"), 2000));
    await page.keyboard.press("Tab");
    const tab1 = await focusIs("[data-handoff-reset-cancel]");
    await page.keyboard.press("Tab");
    const tab2 = await focusIs("[data-handoff-reset-confirm]");
    await page.keyboard.down("Shift");
    await page.keyboard.press("Tab");
    await page.keyboard.up("Shift");
    const tab3 = await focusIs("[data-handoff-reset-cancel]");
    step("…Tab / Shift+Tab stay inside the dialog", tab1 && tab2 && tab3, `${tab1} ${tab2} ${tab3}`);
    await shot(page, "4-reset-dialog");
    await page.keyboard.press("Escape");
    step("…Escape closes it and focus returns to the Reset button", (await waitFor(() => page.evaluate(() => !document.querySelector("[data-handoff-reset-dialog]")), 3000)) && (await focusIs("[data-handoff-reset]")));
    await page.click("[data-handoff-reset]");
    await waitFor(() => page.evaluate(() => !!document.querySelector("[data-handoff-reset-cancel]")), 3000);
    await page.click("[data-handoff-reset-cancel]");
    step("Cancel closes it and changes nothing", (await waitFor(() => page.evaluate(() => !document.querySelector("[data-handoff-reset-dialog]")), 3000)) && Number(await (await firstQtyInput(page))?.evaluate((i) => i.value)) === qty0 + 1);
    await page.click("[data-handoff-reset]");
    await waitFor(() => page.evaluate(() => !!document.querySelector("[data-handoff-reset-confirm]")), 3000);
    await Promise.all([page.waitForNavigation({ waitUntil: "load", timeout: 20_000 }), page.click("[data-handoff-reset-confirm]")]);
    step("Reset reloads the page", await waitMounted(page, sink));
    const qtyBack = await firstQtyInput(page);
    step("…the edited quantity is the seed value again", !!qtyBack && Number(await qtyBack.evaluate((i) => i.value)) === qty0, `${qtyBack ? await qtyBack.evaluate((i) => i.value) : "?"} vs ${qty0}`);
    step("…and the header total is the seed's", (await readHeaderTotal(page)) === totalSeed, `${await readHeaderTotal(page)} vs ${totalSeed}`);
    await push(page, "/quotes");
    await waitList(page);
    step("…and the estimate created earlier is gone from the list", (await listRowIds(page)).length === system.length);
    await noteUnregistered(page);

    // 9b — a Reset another window blocks (it holds the database and never lets go): the dialog says so and stays open
    const holder = await newPage(browser, sink);
    await openUrl(holder, base);
    await holder.waitForSelector("[data-handoff-ready]", { timeout: 15_000 });
    await holder.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const r = indexedDB.open((window as unknown as { __peakHandoff: { store: { dbName: string } } }).__peakHandoff.store.dbName);
          r.onsuccess = () => {
            (window as unknown as { __rawHold?: IDBDatabase }).__rawHold = r.result; // no onversionchange handler
            resolve();
          };
          r.onerror = () => reject(r.error);
        }),
    );
    await page.bringToFront();
    await page.click("[data-handoff-reset]");
    await waitFor(() => page.evaluate(() => !!document.querySelector("[data-handoff-reset-confirm]")), 3000);
    await page.click("[data-handoff-reset-confirm]");
    const blockedMsg = await waitFor(async () => (await page.evaluate(() => (document.querySelector("[data-handoff-reset-error]") as HTMLElement | null)?.innerText ?? "")) === "Close other prototype windows and try again.", 10_000);
    step("a Reset blocked by another window shows “Close other prototype windows and try again.” in the dialog", blockedMsg && (await page.evaluate(() => !!document.querySelector("[data-handoff-reset-dialog]"))), await page.evaluate(() => (document.querySelector("[data-handoff-reset-error]") as HTMLElement | null)?.innerText ?? "(no message)"));
    step("…and focus is back on the dialog's primary control", await focusIs("[data-handoff-reset-confirm]"));
    await holder.evaluate(() => (window as unknown as { __rawHold?: IDBDatabase }).__rawHold?.close());
    await holder.close();
    await page.click("[data-handoff-reset-cancel]");
    await page.evaluate((k) => localStorage.removeItem(k), CURRENT_USER_KEY);
    await page.close();

    // 10 — no IndexedDB: the not-persistent notice
    const mem = await newPage(browser, sink);
    await mem.evaluateOnNewDocument(`Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });`);
    await openUrl(mem, base);
    await waitList(mem);
    step("without IndexedDB the banner adds “Changes won't be saved in this window”", await waitFor(() => pageHasText(mem, "Changes won't be saved in this window"), 5000));
    await mem.close();
  } catch (e) {
    // A step that cannot run (a missing element) is a failure with a reason, not a crash that hides the steps before it.
    step("the walk completed", false, e instanceof Error ? e.message.split("\n")[0] : String(e));
  } finally {
    await browser.close();
  }
  const unexpectedUnregistered = [...unexpected];
  const pass = steps.every((s) => s.ok) && unexpectedUnregistered.length === 0 && sink.pageErrors.length === 0 && sink.foreignRequests.length === 0 && sink.failedLocal.length === 0;
  return { pass, rows: system.length, steps, screenshots, unexpectedUnregistered, ...sink };
}

export function printShell(r: ShellResult): void {
  console.log(`handoff:verify --shell  ${r.pass ? "PASS" : "FAIL"} (${r.rows} system estimates)`);
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

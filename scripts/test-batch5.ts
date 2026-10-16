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
import { lastViewedAt, opensChip, PACKAGE_COPY, viewedStamp } from "../src/lib/quote-share/package-view";
import { ONLINE_VIEW_LABELS } from "../src/lib/quote-share/view";
import { packageViewModel } from "../src/lib/estimate-output/package-model";
import PackageView from "../src/components/estimate-output/package-view";
import { CLIENT_PACKAGE_COPY } from "../src/lib/estimate-output/client-package-ui";
import { PACKAGE_TAB_LABEL } from "../src/lib/estimate-steps/package-tabs";
import type { Quote, QuoteRevision } from "../src/lib/stores/quotes";
import { isReopen, reopenedAtWonVersion, reopenTarget, REOPEN_AUTOSAVE_NOTE, sameWonContent, tracksWonVersion, WON_SNAPSHOT_NOTE, wonRevision } from "../src/lib/quote-won-version";
import { createFixture, dropFixtures, fixtureId, registerFixture } from "./test-fixtures";
import { compareImages } from "../src/lib/part-docs/types";
import { NEW_SYSTEM_PRESENTATION, presentationForNewSystem } from "../src/lib/estimate-output/fields";
import { estimateReadiness } from "../src/lib/estimate-steps/readiness";
import { systemFromCategory } from "../src/lib/system-categories";
import { systemFromSuggestion } from "../src/lib/assist/features/suggestion";
import { photoSkusOf } from "../src/app/(app)/estimator/narrative";
import { can } from "../src/lib/team";

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
  const hub = src("src/app/(app)/quotes/page.tsx");
  ok(opensChip(q)?.viewed === "Viewed Oct 6, 9:05 PM" && hub.includes('{opened?.viewed ? <span data-testid="quote-viewed-stamp"') && hub.includes("{opened.viewed}</span>"),
    "#355 review M7: the Viewed stamp also shows as visible text on the Quotes hub row");
  // #355 review M8 — Home and the Quotes hub say when a move reopened a won estimate at the version that won.
  const qa = src("src/app/(app)/quotes/actions.ts");
  const ha = src("src/app/(app)/home-actions.ts");
  const sheet = src("src/app/(app)/home-stage-sheet.tsx");
  ok(qa.includes('if (reopenedAtWonVersion(before, q)) redirect(back + (back.includes("?") ? "&" : "?") + "statusNotice=" + encodeURIComponent(REOPENED_AT_WON_NOTICE));') &&
     hub.includes("const creditNotice = one(sp.creditNotice) || one(sp.statusNotice) || null;"), "#355 review M8: the Quotes hub shows the reopen notice");
  ok(ha.includes("return reopenedAtWonVersion(before, after) ? { ok: true, notice: REOPENED_AT_WON_NOTICE } : { ok: true };") && sheet.includes("if (res.notice) {") &&
     sheet.includes('data-testid="reopened-at-won-notice"') && !sheet.includes("@/lib/stores/") && !sheet.includes("quote-won-version"),
    "#355 review M8: Home's stage sheet shows the reopen notice (the client sheet imports no store)");
  const panel = src("src/app/(app)/estimator/client-link-panel.tsx");
  ok(panel.includes('data-testid="client-link-viewed"') && panel.includes("{status.viewed}"), "#58: Send & track's Client link panel shows the Viewed stamp");
  ok(/sentRevs: sentRevisionRows\(q\), viewed: viewedStamp\(q\) \}/.test(src("src/lib/quote-share/links.ts")), "#58: the panel's status carries the stamp (staff-only server action)");
  for (const f of ["src/app/share/quote/[id]/[token]/page.tsx", "src/app/share/quote/[id]/[token]/package-page.tsx", "src/app/share/quote/[id]/[token]/package-slots.tsx",
    "src/components/estimate-output/package-view.tsx", "src/lib/estimate-output/package-model.ts", "src/app/portal/quotes/[id]/page.tsx", "src/app/portal/quotes/[id]/bom-view.tsx"]) {
    const t = src(f);
    ok(!t.includes("viewedStamp") && !t.includes("lastViewedAt") && !t.includes("COPY.viewed") && !t.includes("shareOpens"), `#58: the customer never sees it — ${f} reads no open stamp`);
  }
}


/* --- #59 reopening a won estimate loads the version that won --- */
type Sec = { id: string; name: string; kind: string; mfr: string; freightPct: number; items: Array<Record<string, unknown>> };
const b5sec = (price: number): Sec => ({ id: "s", name: "S", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 1, sku: "X", desc: "X", qty: 1, unit: "ea", cost: 1000, price }] });
function wonVersionChecks(ok: Ok) {
  const rev = (n: number, reason: "sent" | "manual", price: number, extra: Partial<QuoteRevision> = {}) =>
    ({ rev: n, at: n, by: "x", reason, note: "", name: "Q", value: price, margin: 0.3, status: "sent", spec: { sections: [b5sec(price)], mobs: [] }, ...extra }) as unknown as QuoteRevision;
  const live = (price: number, extra: Record<string, unknown> = {}) =>
    ({ status: "won", name: "Q", value: price, margin: 0.3, spec: { sections: [b5sec(price)], mobs: [] }, revisions: [rev(1, "sent", 2000)], wonRev: 1, ...extra }) as unknown as Quote;
  ok(isReopen("won", "draft") && isReopen("won", "sent") && !isReopen("won", "lost") && !isReopen("sent", "draft") && !isReopen("won", "won"), "#59: a reopen is won → draft (a revise) or won → sent");
  ok(sameWonContent({ spec: { b: 1, a: [1, { y: 2, x: 1 }] }, value: 10.2 }, { value: 10, spec: { a: [1, { x: 1, y: 2 }], b: 1 } }), "#59: content compares by value (key order and value rounding don't count)");
  ok(!sameWonContent({ spec: { a: 1 } }, { spec: { a: 2 } }) && !sameWonContent({ name: "A" }, { name: "B" }), "#59: a changed price or name is a change");
  ok(wonRevision(live(2000))?.rev === 1 && wonRevision(live(2000, { wonRev: 7 })) === null && wonRevision(live(2000, { wonRev: undefined })) === null, "#59: wonRev names a revision, or nothing");
  ok(reopenTarget(live(2000), "draft") === null, "#59: reopening with no edits since the win changes nothing");
  ok(reopenTarget(live(3000), "draft")?.rev === 1 && reopenTarget(live(3000), "sent")?.rev === 1, "#59: edits saved after the win → the won revision is put back (draft or sent)");
  ok(reopenTarget(live(3000), "lost") === null && reopenTarget(live(3000, { status: "sent" }), "draft") === null, "#59: only a move out of Won reopens");
  ok(reopenTarget(live(3000, { wonRev: null }), "draft") === null, "#59: a quote won before #59 (no wonRev) reopens as before");
  // A catalog rename alone is not an edit: the rewrite brings the won spec to the live SKUs first.
  const renamed = live(2000, { spec: { sections: [{ ...b5sec(2000), items: [{ ...b5sec(2000).items[0], sku: "Brand:X" }] }], mobs: [] } });
  const rw = (sp: unknown) => JSON.parse(JSON.stringify(sp).replace(/"sku":"X"/g, '"sku":"Brand:X"'));
  ok(reopenTarget(renamed, "draft", rw) === null && reopenTarget(renamed, "draft")?.rev === 1, "#59: a rename since the win (applied by the rewrite) is not a change");
  ok(tracksWonVersion({ quoteType: "system", source: "estimator" }) && tracksWonVersion({ quoteType: undefined, source: "estimator" }) &&
     !tracksWonVersion({ quoteType: "flame_test", source: "estimator" }) && !tracksWonVersion({ quoteType: "system", source: "daylite" }), "#59: system estimates only, never Daylite history");
  const before = { status: "won", revisions: [rev(1, "sent", 2000)] } as unknown as Quote;
  ok(reopenedAtWonVersion(before, { revisions: [rev(1, "sent", 2000), rev(2, "manual", 3000, { note: REOPEN_AUTOSAVE_NOTE }), rev(3, "sent", 2000)] } as unknown as Quote) &&
     !reopenedAtWonVersion(before, { revisions: [rev(1, "sent", 2000)] } as unknown as Quote) &&
     !reopenedAtWonVersion({ ...before, status: "sent" } as Quote, { revisions: [rev(1, "sent", 2000), rev(2, "manual", 3000, { note: REOPEN_AUTOSAVE_NOTE })] } as unknown as Quote),
    "#59: the action tells the Estimator to reload only when this move put the won version back");
  const st = src("src/lib/stores/quotes.ts");
  ok(/doc\.wonRev = sent && sentLive && sameWonContent\(sentLive, doc\) \? sent\.rev : pushRevision\(doc, by \|\| DEFAULT_ACTOR, "manual", WON_SNAPSHOT_NOTE\)\.rev;/.test(st) &&
     st.includes('const recordsWon = status === "won" && tracksWonVersion(q) && opts.bypassApprovalGate !== "historical-import";') &&
     st.includes("const sentLive = sent ? { ...sent, spec: wonRewrite(sent.spec ?? null) } : null;"),
    "#59 / #355 M3: setStatus records the won version at the Won transition, comparing at today's SKUs (never for a historical import)");
  ok(/const c = await restoredCreditFor\(q, target, true\);/.test(st) && st.includes("withRestoredCredit(doc, plan.credit);") && st.includes("delete clean.wonRev;"),
    "#59: the reopen's credit goes through restoredCreditFor → settleCredit (locked while still won); update() can't set wonRev");
  ok(st.indexOf("const reopen = await reopenPlanFor(q, status, opts);") < st.indexOf("const gate = decideApprovalGate(status, gateQ, limits, opts, Date.now(), by ?? null);") &&
     st.includes("const gateQ = asReopened(q, reopen);") && st.includes("const d = decideApprovalGate(status, asReopened(q, plan), await loadReviewLimitContext(), {}, Date.now(), actor);"),
    "#355 review I1: setStatus and the actions' pre-check (checkApprovalGate) both judge the reopened version through one helper");
  ok(st.includes("if (out && (revised.value || reopened.value)) await scheduleRevisePdfSafely(id);"), "#355 review I2: a restoring reopen re-renders its PDF (won → sent too)");
  const us = src("src/app/(app)/estimator/use-estimator-state.ts");
  ok((us.match(/if \(r\.reopenedAtWon\) \{\s*window\.location\.reload\(\);/g) || []).length === 2, "#59: the Estimator reloads after a status or stage move that put the won version back");
  ok(/if \(res\.reopenedAtWon\) \{\s*window\.location\.reload\(\);/.test(us) && src("src/app/(app)/estimator/actions.ts").includes("reopenedAtWon = reopenedAtWonVersion(beforeMove, q);"),
    "#355 review M2: a Save whose status move reopened a won estimate reloads too");
  ok(us.includes('if (prevStatus === "won" && v !== "won" && pdfDirty && (await saveNow()) === false) {') && us.includes('if (prevStatus === "won" && pdfDirty && (await saveNow()) === false) {') &&
     us.indexOf('if (prevStatus === "won" && v !== "won" && pdfDirty') < us.indexOf("const r = await setStatusAction(id, v,"),
    "#355 review I3: leaving Won with unsaved edits saves them first (status menu and stage bar), so the reopen snapshot keeps them");
}

/* --- #60 a key product with no photo uses its datasheet's page-1 thumbnail (already so — pinned) --- */
function thumbnailPhotoChecks(ok: Ok) {
  const real = { source: "upload" as const, sort: null, uploadedAt: 200 };
  const thumb = { source: "datasheet-render" as const, sort: 0, uploadedAt: 100 };
  ok(compareImages(thumb, real) > 0 && compareImages(real, thumb) < 0, "#60: a datasheet-render thumbnail sorts after every real photo, whatever its sort or age (a real photo always wins)");
  const ph = src("src/lib/narrative/photos.ts");
  ok(ph.includes("const { parts, images } = await partsAndImagesBySku(") && ph.includes("images.get(read(sku))?.[0]") && ph.indexOf("images.get(read(sku))?.[0]") < ph.indexOf("manufacturerImageLookup("),
    "#60: document photos take the part's first visible image (own photo, else its datasheet thumbnail) before the manufacturer image");
  ok(/\.filter\(\(l\) => l\.kind === "image" && !l\.hidden\)/.test(src("src/lib/stores/part-documents.ts")), "#60: a thumbnail hidden on the part never prints");
  for (const f of ["src/lib/quote-pdf/document-loader.ts", "src/lib/quote-share/photo-response.ts"]) ok(src(f).includes("keyProductPhotoDocs("), `#60: ${f} reads the one chain (PDF, online and package photos)`);
}

/* --- #61 new estimates default to the Narrative presentation --- */
function presentationChecks(ok: Ok) {
  ok(NEW_SYSTEM_PRESENTATION === "narrative", "#61: a new estimate's first system is Narrative");
  const sys = (presentation?: "itemized" | "narrative") => ({ ...(presentation ? { presentation } : {}) });
  ok(presentationForNewSystem([]) === "narrative" && presentationForNewSystem([sys("narrative"), sys()]) === "narrative" &&
     presentationForNewSystem([sys(), sys("narrative")]) === "itemized" && presentationForNewSystem([sys("itemized")]) === "itemized",
    "#355 review M6: + Add system follows the estimate's first system (absent = Itemized); no system yet → Narrative");
  let n = 10;
  const ctx = { nextId: () => ++n, tierMargin: 0.3, price: (c: number) => c * 2, freightPct: 5, priceRound: 25 };
  const catOpt = { id: "c", name: "Fixtures", items: [{ sku: "A", qty: 1, part: { sku: "A", desc: "A", unit: "ea", cost: 10, list: 20 } }] };
  ok(systemFromCategory(catOpt, [{ sku: "A", qty: 2 }], { ...ctx, presentation: "narrative" }).presentation === "narrative" &&
     systemFromCategory(catOpt, [{ sku: "A", qty: 2 }], { ...ctx, presentation: "itemized" }).presentation === "itemized" &&
     !("presentation" in systemFromCategory(catOpt, [], ctx)), "#355 review M6: a category system takes the presentation it is given (none → no key)");
  ok(systemFromSuggestion({ key: "k", name: "Rigging", categoryId: "c", lines: [] }, new Map(), { ...ctx, presentation: "itemized" }).presentation === "itemized",
    "#355 review M6: a suggested system takes the presentation it is given");
  const us = src("src/app/(app)/estimator/use-estimator-state.ts");
  ok(/const freshSections = [\s\S]{0,400}presentation: NEW_SYSTEM_PRESENTATION/.test(us) && (us.match(/presentation: NEW_SYSTEM_PRESENTATION/g) || []).length === 1 &&
     us.includes("presentation: presentationForNewSystem(ss)") && (us.match(/presentation: presentationForNewSystem\(sections\),/g) || []).length === 2,
    "#355 review M6: only a NEW estimate starts Narrative; + Add system (blank, category, suggestion) follows the estimate");
  const narr = { id: "n", name: "N", kind: "materials", mfr: "", freightPct: 0, presentation: "narrative", items: [{ id: 1, sku: "A", desc: "A", qty: 1, unit: "ea", cost: 1, price: 2 }] };
  const base = { saved: true, review: null, status: "draft" as const, revNum: 1 };
  const send1 = estimateReadiness({ ...base, sections: [narr, { ...narr, id: "n2", narrative: "Intro." }, narr] as never[] }).send;
  ok(send1.state === "gaps" && send1.count === 2 && send1.label === "⚠ 2 narrative systems have no intro text", `#355 review M6: Send & track warns "N narrative systems have no intro text" (${send1.label})`);
  ok(estimateReadiness({ ...base, sections: [{ ...narr, presentation: "itemized" }] as never[] }).send.state === "idle" &&
     estimateReadiness({ ...base, status: "sent", sections: [narr] as never[] }).send.state === "ok", "#355 review M6: only a draft with an intro-less narrative system warns; never blocks (a badge only)");
  // Existing estimates keep their setting: a system saved without the key still reads (and prints) as Itemized.
  const old = { id: "s", name: "Old", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 1, sku: "A", desc: "A", qty: 1, unit: "ea", cost: 1, price: 2 }],
    keyProducts: [{ lineKey: "1", sku: "A", text: "x", photo: true }] };
  ok(photoSkusOf([old] as never[]).length === 0 && photoSkusOf([{ ...old, presentation: "narrative" }] as never[]).join() === "A",
    "#61: a system with no stored presentation stays Itemized (existing estimates unchanged); only an explicit Narrative prints narrative");
  ok(src("src/app/(app)/estimator/quote-document.tsx").includes('presentation: sec.presentation || "itemized"'), "#61: the document still reads an absent presentation as Itemized");
  ok(!src("src/lib/portal-pricing.ts").includes("NEW_SYSTEM_PRESENTATION") && !src("src/lib/assessments/findings-quote.ts").includes("NEW_SYSTEM_PRESENTATION"),
    "#61: portal-built and assessment-findings systems stay itemized");
}

/* --- #62 anyone with `create` edits the shared system intros (already so — pinned) --- */
function introPermissionChecks(ok: Ok) {
  const na = src("src/app/(app)/estimator/narrative-actions.ts");
  for (const f of ["upsertSystemIntroAction", "deleteSystemIntroAction"]) {
    const body = na.slice(na.indexOf(`export async function ${f}(`), na.indexOf(`export async function ${f}(`) + 400);
    ok(body.includes("const user = await requireUser();") && body.includes('if (!can("create", user.roles)) return { ok: false, error: NEEDS_CREATE };') && !body.includes("manage_users"),
      `#62: ${f} needs \`create\` — not admin-only`);
  }
  ok(can("create", ["Estimator"]) && can("create", ["Manager"]) && can("create", ["Admin"]), "#62: every role that holds create (Estimator included) can edit the intros");
  const writers = ["src/app/(app)/estimator/narrative-actions.ts"];
  ok(writers.every((f) => src(f).includes("upsertIntro(")) && !src("src/app/(app)/estimator/narrative-intros-modal.tsx").includes("@/lib/stores/"),
    "#62: the narrative_intros blob is written only through the create-gated actions (the modal imports no store)");
}

/* --- #63 the customer-facing toggle reads Overview / Itemized --- */
function toggleLabelChecks(ok: Ok) {
  ok(ONLINE_VIEW_LABELS.narrative === "Overview" && ONLINE_VIEW_LABELS.bom === "Itemized" && PACKAGE_COPY.narrative === "Overview" && PACKAGE_COPY.bom === "Itemized",
    "#63: the online / package toggle labels are Overview / Itemized");
  ok(PACKAGE_COPY.seeBom === "The full parts list for this scope is under Itemized.", "#63: the package page's pointer to the parts list names the new label");
  const doc = Object.values(qdP2bNoAltCases())[0];
  const model = packageViewModel({ doc, photos: {}, catalog: new Map(), frozen: { coverSummary: "", notIncluded: "" }, state: { kind: "ok", rev: { rev: 1 }, closed: false, won: false } as never,
    headerLine: "EST-1 · Rev 1", currentHref: null, view: "narrative", base: "/b", letterheadSrc: "/lh.jpg" });
  const html = renderToStaticMarkup(createElement(PackageView, { model }));
  ok(/<nav aria-label="Estimate view"[^>]*><a [^>]*>Overview<\/a><a [^>]*href="\/b\?view=bom"[^>]*>Itemized<\/a><\/nav>/.test(html) && !/>Narrative<\/a>|>BOM<\/a>/.test(html),
    "#63: the package page renders Overview / Itemized (the link still carries ?view=bom)");
  const online = src("src/components/online-estimate/online-estimate.tsx");
  ok(online.includes("{ONLINE_VIEW_LABELS.narrative}") && online.includes("{ONLINE_VIEW_LABELS.bom}") && !/>\s*Narrative\s*</.test(online) && !/>\s*BOM\s*</.test(online),
    "#63: the portal / share online estimate toggle reads the same labels");
  ok(CLIENT_PACKAGE_COPY.narrative === "Narrative" && PACKAGE_TAB_LABEL.narrative === "Narrative", "#63: staff-side labels (Client package presentation, Build package tabs) are unchanged");
}

export async function batch5PureChecks(ok: Ok) {
  coverHeadingChecks(ok);
  viewedChecks(ok);
  wonVersionChecks(ok);
  thumbnailPhotoChecks(ok);
  presentationChecks(ok);
  introPermissionChecks(ok);
  toggleLabelChecks(ok);
}

async function wonVersionDbChecks(ok: Ok) {
  const Q = await import("../src/lib/stores/quotes");
  const L = await import("../src/lib/stores/reward-ledger");
  const { withRewardCredit, quoteRewardCredit } = await import("../src/lib/rewards/credit-line");
  const bypass = { bypassApprovalGate: "engine-owned-flow" as const };
  const CO = fixtureId("b5", "co");
  const spec = (price: number) => ({ sections: withRewardCredit([b5sec(price)] as never[], 100, 2), mobs: [] });
  const priceOf = (q: { spec?: unknown } | null | undefined) =>
    ((q?.spec as { sections?: Sec[] } | undefined)?.sections?.[0]?.items || []).find((it) => it.sku === "X")?.price;
  const mk = async (slug: string) => {
    const id = fixtureId("b5", slug);
    await createFixture("quotes", Q.buildQuote(id, { name: `B5 ${slug}`, customer: "B5 Co", customerId: CO, value: 1900, spec: spec(2000) } as never, "system", null, Date.now()) as never);
    return id;
  };
  try {
    // A: sent → won (matches the send: no extra snapshot) → edits after the win → reopen puts the won version back.
    const A = await mk("a");
    await Q.setStatus(A, "sent", "Pat", bypass);
    await Q.setStatus(A, "won", "Pat", bypass);
    const a1 = (await Q.get(A))!;
    const sentA = a1.revisions!.filter((r) => r.reason === "sent").at(-1)!;
    ok(a1.wonRev === sentA.rev && a1.revisions!.length === 1, "#59 db: won straight after a send → wonRev is that send, no extra snapshot");
    const ledgerWon = (await L.ledgerForQuote(A)).map((e) => e.id).sort().join(",");
    await Q.update(A, { spec: spec(3000), value: 2900, wonRev: 99 } as never);
    ok((await Q.get(A))!.wonRev === sentA.rev, "#59 db: update() can't move wonRev");
    await Q.setStatus(A, "draft", "Pat");
    const a2 = (await Q.get(A))!;
    const auto = a2.revisions!.at(-1)!;
    ok(a2.status === "draft" && priceOf(a2) === 2000 && a2.value === 1900, `#59 db: reopening loads the version that won (price ${priceOf(a2)}, value ${a2.value})`);
    ok(auto.reason === "manual" && auto.note === REOPEN_AUTOSAVE_NOTE && priceOf(auto) === 3000 && auto.status === "won", "#59 db: the edits made after the win are kept as a revision first");
    ok(quoteRewardCredit(a2) === 100, `#59 db: the Rewards credit is the locked amount, re-homed on the won version (${quoteRewardCredit(a2)})`);
    const led = (await L.ledgerForQuote(A)).map((e) => e.id).sort();
    ok(ledgerWon.includes(`redeem:${A}:1`) && led.includes(`redeem:${A}:1`) && led.includes(`unredeem:${A}:1`) && led.filter((x) => x.startsWith("unredeem:")).length === 1,
      `#59 db: the ledger sees a plain revise — the redeem is returned once (${led.join(",")})`);
    // Re-win from the reopened draft with no edits: wonRev = a fresh snapshot? No — the live quote matches the last SEND, so that send.
    await Q.setStatus(A, "won", "Pat", bypass);
    ok((await Q.get(A))!.wonRev === sentA.rev, "#59 db: re-winning unchanged points at the same send again");

    // B: recalled after its last send and won from the draft → the won snapshot, not the last send.
    const B = await mk("b");
    await Q.setStatus(B, "sent", "Pat", bypass);
    await Q.setStatus(B, "draft", "Pat");
    await Q.update(B, { spec: spec(2500), value: 2400 } as never);
    await Q.setStatus(B, "won", "Pat", bypass);
    const b1 = (await Q.get(B))!;
    const wonB = b1.revisions!.find((r) => r.rev === b1.wonRev);
    ok(!!wonB && wonB.reason === "manual" && wonB.note === WON_SNAPSHOT_NOTE && priceOf(wonB) === 2500 && wonB.status === "won",
      "#59 db: won from a draft edited after its last send → a 'Won — the version that won' snapshot");
    const nB = b1.revisions!.length;
    await Q.setStatus(B, "draft", "Pat");
    const b2 = (await Q.get(B))!;
    ok(b2.revisions!.length === nB && priceOf(b2) === 2500, "#59 db: reopening it with no edits since the win loads the won version and adds nothing");
    // …and with an edit since the win, won → sent re-sends the won version.
    await Q.setStatus(B, "won", "Pat", bypass);
    await Q.update(B, { spec: spec(4000), value: 3900 } as never);
    await Q.setStatus(B, "sent", "Pat", bypass);
    const b3 = (await Q.get(B))!;
    const lastSent = b3.revisions!.filter((r) => r.reason === "sent").at(-1)!;
    ok(priceOf(b3) === 2500 && priceOf(lastSent) === 2500 && b3.revisions!.some((r) => r.note === REOPEN_AUTOSAVE_NOTE && priceOf(r) === 4000),
      "#59 db: won → sent with edits since the win sends the version that won (the edits kept as a revision)");

    // C: a historical import never records a won version, and never reopens one.
    const C = await mk("c");
    await Q.setStatus(C, "won", "Pat", { bypassApprovalGate: "historical-import" });
    ok((await Q.get(C))!.wonRev === null, "#59 db: a historical-import win records no won version (wonRev null)");
    await Q.setStatus(C, "draft", "Pat");
    await Q.setStatus(C, "sent", "Pat", bypass);
    await Q.setStatus(C, "won", "Pat", bypass);
    const c1 = (await Q.get(C))!;
    ok(typeof c1.wonRev === "number", "#59 db: a later real win records it");
    await Q.update(C, { spec: spec(3100), value: 3000 } as never);
    await Q.setStatus(C, "draft", "Pat", { bypassApprovalGate: "historical-import" });
    const c2 = (await Q.get(C))!;
    ok(priceOf(c2) === 3100 && !c2.revisions!.some((r) => r.note === REOPEN_AUTOSAVE_NOTE), "#355 review M1: a historical-import move out of Won never restores");
    await Q.setStatus(C, "won", "Pat", { bypassApprovalGate: "historical-import" });
    ok((await Q.get(C))!.wonRev === null, "#355 review M1: a Won move that records no version clears the older pointer");

    // #355 review I1 — the approval gate judges the version the reopen will send.
    const { approvalFingerprint } = await import("../src/lib/approval-snapshot");
    const NOBODY = "B5 Not A User";
    const E = await mk("e");
    const e0 = (await Q.get(E))!;
    await Q.update(E, { owner: "B5 Owner", review: { state: "approved", method: "in_app", reviewer: "Jeff Chesebro", decidedBy: "Jeff Chesebro", decidedAt: Date.now(), note: "",
      submittedBy: null, submittedAt: null, auto: null, approvedAgainst: approvalFingerprint(e0) } } as never);
    await Q.setStatus(E, "sent", NOBODY);
    await Q.setStatus(E, "won", NOBODY);
    await Q.update(E, { spec: spec(3200), value: 3100 } as never);
    const T0 = Date.now() - 60_000;
    await Q.updateQuotePdf(E, () => ({ status: "pending", at: T0, savedAt: T0 }) as never);
    const eEdited = (await Q.get(E))!;
    const pre = await Q.checkApprovalGate(eEdited, "sent", NOBODY);
    ok(pre.ok, "#355 review I1: the action's pre-check (checkApprovalGate) passes a non-approver's won → sent reopen — the target is the approved version");
    let threw = false;
    try { await Q.setStatus(E, "sent", NOBODY); } catch { threw = true; }
    const e2 = (await Q.get(E))!;
    ok(!threw && e2.status === "sent" && priceOf(e2) === 2000, `#355 review I1: a non-approver reopens an approved-then-edited won quote to Sent at the approved version (threw ${threw}, ${e2.status}, ${priceOf(e2)})`);
    ok(e2.pdf?.status === "pending" && (e2.pdf?.savedAt ?? 0) > T0 && e2.revisions!.filter((r) => r.reason === "sent").at(-1) !== undefined && priceOf(e2.revisions!.filter((r) => r.reason === "sent").at(-1)) === 2000,
      `#355 review I2: won → sent with a restore sends the won version and schedules its PDF (pdf ${e2.pdf?.status})`);
    // Control: the same edited content with no won version to restore is still refused for a non-approver.
    const F = await mk("f");
    const f0 = (await Q.get(F))!;
    await Q.update(F, { owner: "B5 Owner", review: { state: "approved", method: "in_app", reviewer: "Jeff Chesebro", decidedBy: "Jeff Chesebro", decidedAt: Date.now(), note: "",
      submittedBy: null, submittedAt: null, auto: null, approvedAgainst: approvalFingerprint(f0) } } as never);
    await Q.update(F, { spec: spec(3200), value: 3100 } as never);
    let fThrew = false;
    try { await Q.setStatus(F, "sent", NOBODY); } catch { fThrew = true; }
    ok(fThrew && (await Q.get(F))!.status === "draft", "#355 review I1 control: a changed, unrestored quote still needs a fresh approval");
    // An approver's reopen: the new stamp fingerprints the restored content, not the post-win edits.
    const G = await mk("g");
    await Q.update(G, { owner: "B5 Owner" } as never);
    await Q.setStatus(G, "sent", "Pat", bypass);
    await Q.setStatus(G, "won", "Pat", bypass);
    await Q.update(G, { spec: spec(3300), value: 3200 } as never);
    const gEdited = (await Q.get(G))!;
    await Q.setStatus(G, "sent", "Jeff Chesebro");
    const g2 = (await Q.get(G))!;
    const fp = g2.review?.approvedAgainst;
    ok(g2.status === "sent" && priceOf(g2) === 2000 && !!fp && JSON.stringify(fp) === JSON.stringify(approvalFingerprint(g2)) && JSON.stringify(fp) !== JSON.stringify(approvalFingerprint(gEdited)),
      `#355 review I1: an approver's stamp on the reopen fingerprints the restored version (${JSON.stringify(fp)})`);
    // Control for I2: a won → sent with nothing to restore schedules nothing new.
    const H = await mk("h");
    await Q.setStatus(H, "sent", "Pat", bypass);
    await Q.setStatus(H, "won", "Pat", bypass);
    await Q.updateQuotePdf(H, () => ({ status: "pending", at: T0, savedAt: T0 }) as never);
    const hPdf = JSON.stringify((await Q.get(H))!.pdf ?? null);
    await Q.setStatus(H, "sent", "Pat", bypass);
    ok(JSON.stringify((await Q.get(H))!.pdf ?? null) === hPdf, "#355 review I2 control: won → sent with no restore leaves the PDF state alone");
  } finally {
    await dropFixtures("b5");
  }
}

async function thumbnailPhotoDbChecks(ok: Ok) {
  const DS = await import("../src/db/doc-store");
  const D = await import("../src/lib/stores/part-documents");
  const { keyProductPhotoDocs } = await import("../src/lib/narrative/photos");
  const SKU = fixtureId("b5", "ph-part");
  try {
    await DS.upsertDoc("catalog_parts", { id: SKU, sku: SKU, desc: "B5 photo part", category: "Other", unit: "ea", list: 40, cost: 20, mfr: "B5 Photo Mfr" } as never);
    registerFixture("catalog_parts", SKU);
    const mk = async (fileName: string, source: "upload" | "datasheet-render") => {
      const d = await D.createDocument({ kind: "image", fileName, contentType: "image/webp", size: 1000, blobKey: `part-docs/PD-fixture-b5/${fileName}`, sourceUrl: null, source, by: "Test" });
      if (!d) throw new Error("#60: fixture document failed");
      registerFixture("part_documents", d.id);
      await D.attachDocument(d.id, [SKU], "Test");
      registerFixture("part_document_links", D.documentLinkId(SKU, d.id));
      return d;
    };
    const sections = [{ id: "s1", name: "Lights", kind: "materials", mfr: "", freightPct: 0, presentation: "narrative", narrative: "Intro.",
      items: [{ id: 1, sku: SKU, desc: "Line", qty: 1, unit: "ea", cost: 10, price: 25 }],
      keyProducts: [{ lineKey: "1", sku: SKU, text: "The light.", photo: true }] }] as never[];
    ok(!(await keyProductPhotoDocs(sections)).has(SKU), "#60 db: no photo and no thumbnail → nothing (the rest of the chain decides)");
    const thumb = await mk("b5-thumb.webp", "datasheet-render");
    ok((await keyProductPhotoDocs(sections)).get(SKU)?.id === thumb.id, "#60 db: no real photo → the datasheet's page-1 thumbnail prints");
    const photo = await mk("b5-photo.webp", "upload");
    ok((await keyProductPhotoDocs(sections)).get(SKU)?.id === photo.id, "#60 db: a real photo always wins over the thumbnail");
  } finally {
    await dropFixtures("b5");
  }
}

export async function batch5DbChecks(ok: Ok) {
  await wonVersionDbChecks(ok);
  await thumbnailPhotoDbChecks(ok);
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

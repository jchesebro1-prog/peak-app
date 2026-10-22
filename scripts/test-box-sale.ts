/* Box goods sale (docs/superpowers/specs/2026-10-21-box-goods-sale-design.md) — harness checks.
   `boxSalePureChecks` needs no database; `boxSaleDbChecks` needs the test DB (test:specs runs both).
   Pure half alone: `npx tsx scripts/test-box-sale.ts`.
   Both halves: `TEST_DB=$(mktemp -d) && PGLITE_PATH="$TEST_DB" npx tsx scripts/test-box-sale.ts; rm -rf "$TEST_DB"`
   (never without PGLITE_PATH pointing at a fresh temp dir — the DB half writes quotes). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { dropFixtures, fixtureId, registerFixture } from "./test-fixtures";
import {
  BOX_SALE_LABOR_MESSAGE,
  boxSaleForSave,
  boxSaleLaborSystems,
  boxSaleOf,
  boxSaleSaveProblem,
  isBoxSaleQuoteType,
  lineIsLabor,
  revisionBoxSale,
  systemHasLabor,
} from "../src/lib/estimate-box-sale/rules";
import { buildQuote, quoteContentKey, QUOTE_CONTENT_FIELDS, revisionDocFields, type Quote, type QuoteRevision } from "../src/lib/stores/quotes";
import { quoteAsOfRevision } from "../src/lib/quote-share/view";
import { quoteDocumentDataFor } from "../src/lib/quote-pdf/quote-document-data";
import { bomViewProps } from "../src/app/(app)/estimator/quote-document-view";
import { loadAppendixSources } from "../src/lib/quote-pdf/generate";
import { renderCoverPdf } from "../src/lib/estimate-output/cover-pdf-server";
import { renderBomPdf } from "../src/lib/estimate-output/bom-pdf-server";
import { BOX_SALE_COPY, boxSaleLaborBanner, newSystemPresentation } from "../src/lib/estimate-box-sale/rules";
import { pdfDocKey } from "../src/app/(app)/estimator/pdf-doc-key";
import { normalizePdfOptions } from "../src/lib/quote-pdf/pdf-options";
import { BOX_SALE_PACKAGE_TABS, boxSalePackageTab, PACKAGE_TABS, packageTabsFor, parsePackageTab } from "../src/lib/estimate-steps/package-tabs";
import { BOX_SALE_REVIEW_TABS, nextReviewTab, REVIEW_TABS, reviewTabsFor } from "../src/lib/estimate-review/review-ui";
import { estimateReadiness } from "../src/lib/estimate-steps/readiness";
import { composerInitial, withoutCoverForBoxSale } from "../src/lib/estimate-email/send-ui";
import { bidderEmailDefaults, estimateEmailDefaults } from "../src/lib/estimate-email/compose";
import { packageViewModel } from "../src/lib/estimate-output/package-model";
import { boxSaleExtras } from "../src/lib/estimate-output/package-extras-model";
import PackageView from "../src/components/estimate-output/package-view";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BUILDER_BASE, builderPath, isServiceType, SERVICE_TYPES } from "../src/app/(app)/quotes/new/types";
import { boxSwitchHint, quoteEditPath, quoteServiceType, readHandoff, sameBuilder } from "../src/app/(app)/quotes/new/handoff";
import { openEstimateInInbox, sendEstimateEmail, type EstimateEmailDeps } from "../src/lib/estimate-email/send-server";
import { onlineCutSheets } from "../src/lib/curtain-cut-sheets/online";
import { isBoxSaleSource } from "../src/lib/estimate-box-sale/rules";
// (later tasks: imports above this line)

export const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
export const FIX = "box";
export const SET = { companyName: "Peak", logoDark: null };

type Line = Record<string, unknown>;
export const line = (id: number, extra: Line = {}): Line => ({ id, sku: "SKU-" + id, desc: "Part " + id, qty: 2, unit: "ea", cost: 50, price: 100, ...extra });
export const sys = (id: string, name: string, items: Line[], extra: Record<string, unknown> = {}) => ({ id, name, kind: "materials", mfr: "", freightPct: 0, items, ...extra });
export const DOC = { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Our approach." }] }] };

/** A saved system estimate: a Narrative system with an intro, an Itemized one, a package document, sectioned + appendix on, Qty off. */
export function quoteFixture(extra: Record<string, unknown> = {}): Quote {
  return {
    id: "Q-box", name: "Gym", customer: "Walk-in", customerId: null, locationId: null, owner: "Sam Mills", status: "draft",
    source: "estimator", quoteType: "system", value: 400, margin: 0.5, createdAt: 5, updatedAt: 5, history: [], review: { state: "none" },
    pdfOptions: { detail: "sectioned", pdfQty: false, pdfNotes: false, pdfPrices: true, pdfItemizedAppendix: true },
    spec: { sections: [sys("s1", "Rigging", [line(1)], { presentation: "narrative", narrative: "Intro." }), sys("s2", "Lighting", [line(2)], { presentation: "itemized" })], mobs: [], document: DOC },
    ...extra,
  } as unknown as Quote;
}

function dataChecks(ok: Ok) {
  ok(isBoxSaleQuoteType(undefined) && isBoxSaleQuoteType(null) && isBoxSaleQuoteType("") && isBoxSaleQuoteType("system") && !isBoxSaleQuoteType("flame_test") && !isBoxSaleQuoteType("consulting"),
    "box sale: only an Estimator system estimate (quoteType absent or \"system\") can be one");
  ok(boxSaleOf({ boxSale: true }) && boxSaleOf({ boxSale: true, quoteType: "system" }) && !boxSaleOf({ boxSale: true, quoteType: "repair" }) && !boxSaleOf({ boxSale: "true" }) && !boxSaleOf({}) && !boxSaleOf(null),
    "box sale: boxSaleOf is a stored true on a system estimate; anything else reads false");
  ok(boxSaleForSave(null, true) && !boxSaleForSave(null, false) && !boxSaleForSave(null, undefined) && boxSaleForSave({ boxSale: true }, undefined) && !boxSaleForSave({ boxSale: true }, false) && !boxSaleForSave({ quoteType: "inspection" }, true),
    "box sale: a save stores what it posts, an older caller (no field) keeps the stored flag, a service quote never gets one");
  ok(lineIsLabor({ labor: true }) && lineIsLabor({ laborOverhead: "shop" }) && lineIsLabor({ laborTravel: "hotel" }) && !lineIsLabor({}) && !lineIsLabor({ labor: false }) && !lineIsLabor(null),
    "box sale labor: labor, laborOverhead or laborTravel set is labor (mobilization / travel included)");
  ok(!lineIsLabor({ bonus: "estimator" }) && !lineIsLabor({ bonus: "package", labor: true }),
    "box sale labor: the automatic bonus lines are never labor (the 2% estimator bonus stays)");
  ok(systemHasLabor({ kind: "labor", items: [] }) && systemHasLabor({ kind: "materials", items: [line(1), line(2, { labor: true })] as never }) && !systemHasLabor({ kind: "materials", items: [line(1)] as never }) && !systemHasLabor(null),
    "box sale labor: a kind \"labor\" system, or any labor line, makes a system labor");
  const secs = [sys("a", "Rigging", [line(1)]), sys("b", "Install", [line(2, { labor: true })]), sys("c", "  ", [line(3, { laborTravel: "mileage" })]), { ...sys("d", "Crew", []), kind: "labor" }, sys("e", "Freight only", [line(5, { bonus: "estimator" })])];
  ok(JSON.stringify(boxSaleLaborSystems(secs as never)) === JSON.stringify(["Install", "Untitled system", "Crew"]) && boxSaleLaborSystems(null).length === 0 && boxSaleLaborSystems("junk" as never).length === 0,
    "box sale labor: the systems with labor are named in order (blank → \"Untitled system\"); junk reads as none");
  ok(BOX_SALE_LABOR_MESSAGE === "A box goods sale can't include labor — remove the labor lines or turn off Box goods sale.", "box sale labor: the refusal sentence, verbatim");
  ok(boxSaleSaveProblem(true, secs as never) === BOX_SALE_LABOR_MESSAGE && boxSaleSaveProblem(false, secs as never) === null && boxSaleSaveProblem(true, [sys("a", "Rigging", [line(1)])] as never) === null,
    "box sale labor: a box sale with labor is refused; without labor, or not a box sale, it saves");

  ok((QUOTE_CONTENT_FIELDS as readonly string[]).includes("boxSale"), "box sale store: boxSale is a content field (a toggle stales the PDF)");
  const plain = quoteFixture();
  ok(quoteContentKey(plain) !== quoteContentKey({ ...plain, boxSale: true }) && quoteContentKey(plain) === quoteContentKey({ ...plain, boxSale: false } as never),
    "box sale store: the content key changes with the flag; false and absent are the same document");
  ok(buildQuote("Q-x", { boxSale: true }, "system", null, 1).boxSale === true && !("boxSale" in buildQuote("Q-x", {}, "system", null, 1)) &&
     !("boxSale" in buildQuote("Q-x", { boxSale: true }, "flame_test", null, 1)) && !("boxSale" in buildQuote("Q-x", { boxSale: false }, "system", null, 1)),
    "box sale store: buildQuote keeps the flag only as true on a system quote");
  ok(revisionDocFields(quoteFixture({ boxSale: true })).boxSale === true && !("boxSale" in revisionDocFields(plain)),
    "box sale store: a revision freezes the flag; a normal estimate's docFields are byte-identical (no key)");
  const rev = (docFields: unknown) => ({ rev: 1, at: 10, by: "spec", reason: "sent", note: "", name: "Gym", value: 400, margin: 0.5, status: "sent", spec: plain.spec, docFields }) as unknown as QuoteRevision;
  const liveBox = quoteFixture({ boxSale: true, status: "sent" });
  const oldRev = rev({ ...revisionDocFields(plain) });
  const boxRev = rev(revisionDocFields(liveBox));
  ok(!("boxSale" in quoteAsOfRevision({ ...liveBox, revisions: [oldRev] } as Quote, oldRev)), "box sale revision: a revision cut without the flag reads false, even when the live quote has it");
  ok(quoteAsOfRevision({ ...plain, revisions: [boxRev] } as Quote, boxRev).boxSale === true, "box sale revision: a box-sale revision stays one after the live switch is turned off");
  ok(!("boxSale" in quoteAsOfRevision({ ...plain, revisions: [oldRev] } as Quote, oldRev)), "box sale revision: a normal estimate's as-sent quote has no key");
  ok(revisionBoxSale(boxRev) && !revisionBoxSale(oldRev) && !revisionBoxSale(null) && !revisionBoxSale({ docFields: null }), "box sale revision: revisionBoxSale reads the frozen flag only");
}

function documentChecks(ok: Ok) {
  const dPlain = quoteDocumentDataFor(quoteFixture(), null, SET);
  const boxQ = quoteFixture({ boxSale: true });
  const dBox = quoteDocumentDataFor(boxQ, null, SET);
  ok(dPlain.document !== null && dPlain.detail === "sectioned" && dPlain.pdfItemizedAppendix === true && dPlain.pdfNotes === false && dPlain.sections[0].presentation === "narrative",
    "box sale document: a normal estimate's document data is unchanged (package document, sectioned, appendix, its own Notes choice, a Narrative system)");
  ok(dBox.document === null && dBox.detail === "itemized" && dBox.pdfItemizedAppendix === false && dBox.pdfNotes === true && dBox.sections.every((s) => s.presentation === "itemized"),
    "box sale document: a box sale is the BOM view — no package document, itemized, notes on, no appendix, every system itemized");
  ok(dBox.pdfQty === false && dBox.pdfPrices === true, "box sale document: Qty and prices follow the quote's own PDF choices (bomViewProps's rule)");
  ok(JSON.stringify(dBox) === JSON.stringify(bomViewProps(dPlain)), "box sale document: the transform IS bomViewProps — one implementation");
  ok(JSON.stringify(quoteDocumentDataFor(quoteFixture({ boxSale: true, quoteType: "flame_test" }), null, SET)) === JSON.stringify(quoteDocumentDataFor(quoteFixture({ quoteType: "flame_test" }), null, SET)),
    "box sale document: a stray flag on a service quote changes nothing");
  const stored = boxQ.spec as { sections: Array<{ presentation?: string; narrative?: string }>; document: unknown };
  ok(stored.sections[0].presentation === "narrative" && stored.sections[0].narrative === "Intro." && stored.document === DOC,
    "box sale document: the stored narrative, presentation and package document are untouched (nothing is deleted)");
  const qdd = rd("src/lib/quote-pdf/quote-document-data.ts");
  ok(qdd.includes('import { bomViewProps } from "@/app/(app)/estimator/quote-document-view";') && qdd.includes("return boxSaleOf(q) ? bomViewProps(props) : props;"),
    "box sale document (source): quoteDocumentDataFor applies bomViewProps once, at the one seam");
}

function wiringChecks(ok: Ok) {
  const act = rd("src/app/(app)/estimator/actions.ts");
  const save = act.slice(act.indexOf("export async function saveQuoteAction("), act.indexOf("async function settleRewardCredit("));
  const at = save.indexOf("const boxProblem = boxSaleSaveProblem(boxSale, Array.isArray(payload.sections) ? payload.sections : []);");
  ok(save.includes("const boxSale = boxSaleForSave(prior, payload.boxSale);") && at > save.indexOf("if (!docSave.ok) return refusedSave(prior, docSave.error);") && save.includes("if (!docSave.ok) return refusedSave(prior, docSave.error);") && at < save.indexOf("settleRewardCredit(") && at < save.indexOf("await update(") && at < save.indexOf("await create("),
    "box sale save (source): the labor refusal runs after the document check and before the Rewards credit or any write");
  ok(save.includes("if (boxProblem) return refusedSave(prior, boxProblem);") && /function refusedSave\(prior: Quote \| null, error: string\): SaveResult \{\s*return \{\s*ok: false,\s*id: null,\s*number: null,/.test(rd("src/app/(app)/estimator/actions.ts")),
    "box sale save (source): a refusal returns no id — nothing is written and the edit stays unsaved");
  ok(/\n\s+boxSale,\n/.test(save.slice(save.indexOf("const patch: QuotePatch = {"), save.indexOf("patch.spec = await quoteSpecFollowingRenames"))),
    "box sale save (source): the patch carries the flag (create and update alike)");
  ok(/boxSale\?: boolean;/.test(act.slice(act.indexOf("export type SavePayload"), act.indexOf("export type SaveResult"))), "box sale save (source): SavePayload carries an optional boxSale");
  const place = act.slice(act.indexOf("async function placeSystemInEstimate("), act.indexOf("export type CopySystemTarget"));
  const carry = place.indexOf("...(boxSaleOf(sourceQuote) ? { boxSale: true } : {}),");
  ok(carry > place.indexOf("created = await create({") && carry < place.indexOf("}, { bidScopeOnly: scopeOnly.stamp });"),
    "box sale move/copy (source): Move / Copy system → New estimate creates the estimate with the STORED source's flag");
  ok(!place.slice(0, place.indexOf("// Estimator bonuses: the new draft estimate")).replace("if (boxSaleOf(existing)) {\n      const problem = boxSaleSaveProblem(true, [placed]);", "").includes("boxSale"),
    "box sale move/copy (source): Move / Copy into an existing estimate leaves the target's flag alone (it only refuses labor into a box sale)");
  const page = rd("src/app/(app)/estimator/page.tsx");
  ok(page.includes("    boxSale: boxSaleOf(q),\n") && page.includes("      boxSale: false,\n") && /\n  boxSale: boolean;\n/.test(rd("src/app/(app)/estimator/types.ts")),
    "box sale load (source): initialFrom hands the Estimator the stored flag (false for a new estimate)");
}

async function storeDbChecks(ok: Ok) {
  const Q = await import("../src/lib/stores/quotes");
  const ID = fixtureId(FIX, "store"), SVC = fixtureId(FIX, "service");
  const base = { customer: "Spec fixture", owner: "spec", source: "estimator", spec: { sections: [], mobs: [] } };
  try {
    await Q.create({ ...base, id: ID, name: "Box store", quoteType: "system", boxSale: true } as never);
    registerFixture("quotes", ID);
    ok((await Q.get(ID))?.boxSale === true, "box sale store (DB): a new system estimate stores the flag");
    await Q.update(ID, { name: "Box store renamed" });
    const kept = (await Q.get(ID))!;
    ok(kept.boxSale === true, "box sale store (DB): a patch without boxSale leaves it alone");
    await new Promise((r) => setTimeout(r, 5));
    await Q.update(ID, { boxSale: false });
    const off = (await Q.get(ID))!;
    ok(!("boxSale" in off), "box sale store (DB): turning it off removes the key (a normal estimate's doc again)");
    ok((off.contentChangedAt ?? 0) > (kept.contentChangedAt ?? 0), "box sale store (DB): a toggle stamps contentChangedAt — the stored PDF goes stale");
    await Q.update(ID, { boxSale: true });
    ok((await Q.get(ID))?.boxSale === true, "box sale store (DB): turning it back on stores it again");
    await Q.create({ ...base, id: SVC, name: "Flame", quoteType: "flame_test", boxSale: true } as never);
    registerFixture("quotes", SVC);
    ok(!("boxSale" in (await Q.get(SVC))!), "box sale store (DB): create drops the flag on a service quote");
    await Q.update(SVC, { boxSale: true });
    ok(!("boxSale" in (await Q.get(SVC))!), "box sale store (DB): update drops it on a service quote too");
    const POR = fixtureId(FIX, "portal");
    await Q.create({ ...base, id: POR, name: "Portal", quoteType: "system", source: "portal-catalog", boxSale: true } as never);
    registerFixture("quotes", POR);
    ok(!("boxSale" in (await Q.get(POR))!), "box sale store (DB): create drops the flag on a portal-catalog quote");
    await Q.update(POR, { boxSale: true });
    ok(!("boxSale" in (await Q.get(POR))!), "box sale store (DB): update drops it on a portal quote too");
  } finally {
    await dropFixtures(FIX);
  }
}

function printChecks(ok: Ok) {
  const page = rd("src/app/print/quote/[id]/page.tsx");
  const srcAt = page.indexOf("const src = revision ? quoteAsOfRevision(q, revision) : q;");
  ok(srcAt > 0 && page.indexOf("const bomLayout = bom || boxSaleOf(src);") > srcAt,
    "box sale print (source): the BOM layout is decided from the quote as printed (a sent revision's frozen flag for a bidder copy)");
  ok(page.includes('!bomLayout && part !== "tail" && cutSheetsOk && normalizePdfOptions(src.pdfOptions).pdfCutSheets') && page.includes('!bomLayout && !bidder && part !== "main" ? loadDatasheetLinkRows(q, origin) : []') &&
     /if \(!bomLayout\) \{\s*const h = await headers\(\);/.test(page) && page.indexOf("if (bomLayout) {") > 0 && page.indexOf("if (bomLayout) {") < page.indexOf("keyProductPhotoDataUris("),
    "box sale print (source): a box sale prints #360's BOM layout — no cut sheets, no datasheet links, no photos, no print-origin read");
  ok(page.includes("if (bom && (rawBidder !== undefined || rawRev !== undefined || rawPart !== undefined)) notFound();"),
    "box sale print (source): ?view=bom's own param gate is unchanged — a box sale's bidder copy still renders");
  ok(rd("src/lib/quote-pdf/generate.ts").includes("if (boxSaleOf(q)) return { drawings: [], hasLinks: false };"), "box sale print (source): loadAppendixSources returns nothing to merge for a box sale");
  ok(rd("src/app/print/cover/[id]/page.tsx").includes('if (!q || pdfKindForQuoteType(q.quoteType) !== "quote" || boxSaleOf(q)) notFound();'), "box sale cover (source): the cover print page is a 404 for a box sale");
  ok(rd("src/lib/estimate-output/cover-pdf-server.ts").includes("refuse: boxSaleOf,") &&
     rd("src/lib/quote-pdf/signed-print-pdf.ts").includes('if (!q || pdfKindForQuoteType(q.quoteType) !== "quote" || opts.refuse?.(q)) return { ok: false, status: 404, error: "Not found" };') &&
     !rd("src/lib/estimate-output/bom-pdf-server.ts").includes("refuse"),
    "box sale cover (source): renderCoverPdf refuses a box sale through the shared render's `refuse` (404); the BOM PDF does not");
  ok(rd("src/lib/estimate-email/send-server.ts").includes("if (input.attachCover === true && !boxSaleOf(q)) {"), "box sale cover (source): the send action never attaches a cover to a box sale");
}

async function printDbChecks(ok: Ok) {
  const file = { id: "PF-0000000000b1", kind: "plan", name: "set.pdf", blobPath: "estimate-files/Q-box/UP-0123456789abcdef/set.pdf", contentType: "application/pdf", size: 2000, source: "upload", addedAt: 1, addedBy: "Pat" };
  const box = await loadAppendixSources(quoteFixture({ boxSale: true, packageFiles: [file] }), "http://localhost:3000");
  const plain = await loadAppendixSources(quoteFixture({ packageFiles: [file] }), "http://localhost:3000");
  ok(box.drawings.length === 0 && box.hasLinks === false, "box sale print (DB): the generator merges no drawings and no links page for a box sale");
  ok(plain.drawings.length === 1, "box sale print (DB): a normal estimate still merges its drawings");
  const Q = await import("../src/lib/stores/quotes");
  const BOX = fixtureId(FIX, "cover-box"), PLAIN = fixtureId(FIX, "cover-plain");
  const base = { customer: "Spec fixture", owner: "spec", source: "estimator", quoteType: "system", spec: { sections: [sys("s1", "Rigging", [line(1)])], mobs: [] } };
  const prev = process.env.AUTH_SECRET;
  try {
    // No secret: a render that gets past the quote checks stops at 503 — Chrome is never launched here.
    delete process.env.AUTH_SECRET;
    await Q.create({ ...base, id: BOX, name: "Cover box", boxSale: true } as never);
    registerFixture("quotes", BOX);
    await Q.create({ ...base, id: PLAIN, name: "Cover plain" } as never);
    registerFixture("quotes", PLAIN);
    const cBox = await renderCoverPdf(BOX, "localhost:3000", "http");
    const cPlain = await renderCoverPdf(PLAIN, "localhost:3000", "http");
    const bBox = await renderBomPdf(BOX, "localhost:3000", "http");
    ok(!cBox.ok && cBox.status === 404, "box sale cover (DB): renderCoverPdf answers 404 for a box sale");
    ok(!cPlain.ok && cPlain.status === 503, "box sale cover (DB): a normal estimate still gets past the quote checks (503 only because AUTH_SECRET is unset here)");
    ok(!bBox.ok && bBox.status === 503, "box sale cover (DB): the BOM PDF still renders for a box sale (503 only for the unset secret)");
  } finally {
    if (prev === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prev;
    await dropFixtures(FIX);
  }
}

function buildUiChecks(ok: Ok) {
  ok(newSystemPresentation([], false) === "narrative" && newSystemPresentation([], true) === "itemized" &&
     newSystemPresentation([{ presentation: "narrative" }], true) === "itemized" && newSystemPresentation([{ presentation: "narrative" }], false) === "narrative" && newSystemPresentation([{}], false) === "itemized",
    "box sale build: new systems are Itemized on a box sale; otherwise the estimate's own rule (#355 M6)");
  ok(boxSaleLaborBanner(["Install", "Crew"]) === "A box goods sale can't include labor — remove the labor lines or turn off Box goods sale. Systems with labor: Install, Crew.",
    "box sale build: the banner is the refusal sentence plus the systems with labor");
  ok(BOX_SALE_COPY.label === "Box goods sale", "box sale build: the switch, the chip and the card all read \"Box goods sale\"");
  const keyIn = { projectName: "P", custName: "C", customerId: null, locationId: null, contactName: "", quoteNote: "", assumptions: "", paymentTerms: "Unknown", sections: [], vendorQuotes: [], pdfOptions: normalizePdfOptions(null) };
  ok(pdfDocKey(keyIn) === pdfDocKey({ ...keyIn, boxSale: false }) && pdfDocKey(keyIn) !== pdfDocKey({ ...keyIn, boxSale: true }),
    "box sale build: the switch is a document change (asks for a Save); off is the same key as before");
  const card = rd("src/app/(app)/estimator/section-card.tsx");
  ok(card.includes("  boxSale?: boolean;") && card.includes("{!p.boxSale && (\n              <a\n                href={p.presentationHref}") && card.includes('sec.kind !== "labor" && !p.boxSale && (') &&
     /\{\/\* #281: a read-only snippet[^\n]*\*\/\}\s*\{!p\.boxSale && \(\s*<button/.test(card) && card.includes('kpStar !== "none" && !p.boxSale && (') &&
     card.includes('{!p.boxSale && addBtn("+ Configure labor", p.onToggleLabor, openMethod === "labor")}'),
    "box sale build (source): the card hides the Customer chip, Discipline, Add narrative…, ★ key product and + Configure labor");
  const head = rd("src/app/(app)/estimator/estimator-header.tsx");
  ok(head.includes("{s.canBoxSale && (") && head.includes('data-testid="box-sale-switch"') && head.includes("onChange={(e) => s.setBoxSale(e.target.checked)}") && head.includes("{s.boxSale && (") && head.includes('data-testid="box-sale-chip"'),
    "box sale build (source): the header has the switch (system estimates only) and a chip while it is on");
  const step = rd("src/app/(app)/estimator/steps/build-step.tsx");
  ok(step.includes("{s.boxSaleLabor.length > 0 && (") && step.includes("{boxSaleLaborBanner(s.boxSaleLabor)}") && step.includes("boxSale={s.boxSale}"),
    "box sale build (source): Build shows the labor banner and tells each card it is a box sale");
  ok(rd("src/app/(app)/estimator/header-more-menu.tsx").includes("{s.aiSource && !s.boxSale && ("), "box sale build (source): More ▾ hides Draft from survey/inspection");
  const us = rd("src/app/(app)/estimator/use-estimator-state.ts");
  ok(us.includes("const [boxSale, setBoxSale] = useState(initial.boxSale);") && us.includes("const canBoxSale = isBoxSaleQuoteType(initial.quoteType) && isBoxSaleSource(initial.bonusSource);") &&
     us.includes("const boxSaleLabor = useMemo(() => (boxSale ? boxSaleLaborSystems(sections) : []), [boxSale, sections]);") && /\n    boxSale,\n    boxSaleLabor,\n    canBoxSale,\n    setBoxSale,\n/.test(us),
    "box sale build (source): the hook holds the flag and the systems with labor, and returns them");
  const saveNow = us.slice(us.indexOf("const saveNow = async (): Promise<number | false> => {"), us.indexOf("const doSave = () => {"));
  const refuse = saveNow.indexOf("const boxProblem = boxSaleSaveProblem(boxSale, sections);");
  ok(refuse > 0 && refuse < saveNow.indexOf("saveQuoteAction(") && /if \(boxProblem\) \{\s*setActionNotice\(null\);\s*setGateRefused\(false\);\s*setActionError\(boxProblem\);\s*return false;\s*\}/.test(saveNow),
    "box sale build (source): Save refuses a box sale with labor in the browser, with the same sentence, and sends nothing");
  ok(saveNow.includes("          boxSale,\n") && us.includes("      boxSale,\n      document: packageDoc,\n    }),") && us.includes("packageDoc, boxSale, sections, groups, vendorQuotes, pdfOpts]"),
    "box sale build (source): the flag rides every Save and is part of the document key");
  ok(us.includes("presentation: newSystemPresentation([], boxSale)") && us.includes("presentation: newSystemPresentation(ss, boxSale)") &&
     (us.match(/presentation: newSystemPresentation\(sections, boxSale\),/g) || []).length === 2 && us.includes("      : freshSections(initialFreightDefault.pct, initial.boxSale)"),
    "box sale build (source): every new system (fresh, blank, category, suggested) is Itemized on a box sale");
}

function packageReviewChecks(ok: Ok) {
  ok(packageTabsFor(true).join() === "bom" && packageTabsFor(false) === PACKAGE_TABS && BOX_SALE_PACKAGE_TABS.join() === "bom", "box sale package: Build package is the BOM quote tab alone");
  ok(["narrative", "client", "bom", null, "junk"].every((raw) => boxSalePackageTab(parsePackageTab(raw), true) === "bom") &&
     boxSalePackageTab(parsePackageTab("client"), false) === "client" && boxSalePackageTab(parsePackageTab(null), false) === "narrative",
    "box sale package: ?ptab=narrative / client (or none) lands on BOM quote; a normal estimate is unchanged");
  ok(reviewTabsFor(true).join() === "document,bom" && reviewTabsFor(false) === REVIEW_TABS && BOX_SALE_REVIEW_TABS.join() === "document,bom", "box sale review: Customer review shows Document and BOM only");
  ok(nextReviewTab("document", "ArrowRight", BOX_SALE_REVIEW_TABS) === "bom" && nextReviewTab("bom", "ArrowRight", BOX_SALE_REVIEW_TABS) === "document" && nextReviewTab("document", "End", BOX_SALE_REVIEW_TABS) === "bom" &&
     nextReviewTab("document", "ArrowRight") === "package" && nextReviewTab("document", "x", BOX_SALE_REVIEW_TABS) === null,
    "box sale review: arrow keys move across the shown tabs only (the default list is unchanged)");
  const narr = sys("n", "Rigging", [line(1)], { presentation: "narrative" });
  const base = { saved: true, sections: [narr] as never[], review: null, status: "draft" as const, revNum: 1 };
  const plainR = estimateReadiness(base), boxR = estimateReadiness({ ...base, boxSale: true });
  ok(boxR.package.state === "ok" && boxR.package.label === "✓ Ready", "box sale readiness: Build package has no narrative / intro / goals / key-product gaps");
  ok(!boxR.send.label.includes("no intro text") && plainR.send.label.includes("no intro text"), "box sale readiness: Send & track drops the no-intro warning");
  ok(plainR.package.state === "gaps", "box sale readiness: a normal estimate still counts its gaps");
  const shell = rd("src/app/(app)/estimator/steps/package-step.tsx");
  ok(shell.includes('const tab = boxSalePackageTab(parsePackageTab(params.get("ptab")), s.boxSale);') && shell.includes("const tabs = packageTabsFor(s.boxSale);") &&
     shell.includes("if (!to || !tabs.includes(to)) return;") && shell.includes("{tabs.map((t) => ("),
    "box sale package (source): the shell lands a box sale on BOM quote and lists only its tabs");
  const bomTab = rd("src/app/(app)/estimator/steps/package-bom-tab.tsx");
  ok(/\{s\.boxSale && \(\s*<div[^>]*data-testid="box-sale-people"[^>]*>\s*<QuotePeopleFields s=\{s\} tone="light" \/>/.test(bomTab) && !/from "@\/lib\/stores\//.test(bomTab),
    "box sale package (source): BOM quote carries Lead estimator / Prepared by on a box sale (and still imports no store)");
  const tabsSrc = rd("src/app/(app)/estimator/steps/review-tabs.tsx");
  ok(tabsSrc.includes("const tabs = reviewTabsFor(s.boxSale);") && tabsSrc.includes('const tab: ReviewTab = tabs.includes(picked) ? picked : "document";') && tabsSrc.includes("{tabs.map((t) => (") && tabsSrc.includes("nextReviewTab(tab, e.key, tabs)"),
    "box sale review (source): the review tabs follow reviewTabsFor; a hidden tab reads as Document");
  ok(rd("src/app/(app)/estimator/steps/review-sidebar.tsx").includes("{!s.boxSale && <PackageChecklist saved={!!loadedId} docs={docs} packageBadge={packageBadge} />}"), "box sale review (source): the sidebar's package checklist is hidden");
  const reviewSrc = rd("src/app/(app)/estimator/steps/review-step.tsx");
  ok(/\{!s\.boxSale && \(\s*<CoverPackagePanel/.test(reviewSrc) && reviewSrc.split("<CoverPackagePanel").length === 2,
    "box sale review (source): the Cover PDF / package panel is not rendered for a box sale");
  ok(reviewSrc.includes("<ClientLinkPanel quoteId={loadedId} withPackage={!s.boxSale} />") && reviewSrc.split("<ClientLinkPanel").length === 2,
    "box sale review (source): the client link stays but its package section is off for a box sale");
  const client = rd("src/app/(app)/estimator/estimator-client.tsx");
  ok(client.includes("        boxSale: s.boxSale,\n") && client.includes("s.trackSummary, s.boxSale]"), "box sale readiness (source): the step badges read the live flag");
  ok(rd("src/lib/estimate-output/package-panel-server.ts").includes("gaps: boxSaleOf(q) ? [] : packageGapChips({"), "box sale readiness (source): the package panel shows no gap chips for a box sale");
}

function sendPackageChecks(ok: Ok) {
  const start = composerInitial(null, null);
  ok(start.attachCover === true && withoutCoverForBoxSale(start, true).attachCover === false && withoutCoverForBoxSale(start, true).attachEstimate === true && withoutCoverForBoxSale(start, false) === start,
    "box sale send: the composer starts with the Estimate PDF ticked and the Cover PDF off");
  const noEst = { estimatePdf: false, coverPdf: true, drawings: true, excludedDatasheets: [] as string[] };
  const unticked = composerInitial(null, noEst);
  ok(unticked.attachEstimate === false && withoutCoverForBoxSale(unticked, false).attachEstimate === false && withoutCoverForBoxSale(unticked, false).attachCover === true,
    "box sale send: a normal estimate starts with the package selection's Estimate PDF choice");
  ok(withoutCoverForBoxSale(unticked, true).attachEstimate === true && withoutCoverForBoxSale(unticked, true).attachCover === false,
    "box sale send: an earlier unticked Estimate PDF is forced back on (the Client package tab is hidden); Cover PDF off");
  const mail = { projectName: "Gym", estimateNumber: "EST-1042", contactName: "Pat Lee", contactEmail: "pat@school.org", senderName: "Sam Mills", senderEmail: "sam@peak.com", leadName: "", leadEmail: "" };
  ok(estimateEmailDefaults({ ...mail, boxSale: true }).body === "Hi Pat,\n\nAttached is our quote for Gym (EST-1042).\n\nYou can also view it online here: {link}\n\nLet me know if you have any questions.\n\nThanks,\nSam Mills",
    "box sale send: the email says \"Attached is our quote … You can also view it online here: {link}\" — no full package, no alternates");
  ok(estimateEmailDefaults(mail).body === "Hi Pat,\n\nAttached is our estimate for Gym (EST-1042).\n\nYou can also view the full package online, and choose any alternates, here: {link}\n\nLet me know if you have any questions.\n\nThanks,\nSam Mills",
    "box sale send: a normal estimate's email is unchanged");
  ok(estimateEmailDefaults({ ...mail, boxSale: true }).subject === estimateEmailDefaults(mail).subject.replace(" — estimate ", " — quote ") && / — quote EST-1042$/.test(estimateEmailDefaults({ ...mail, boxSale: true }).subject) && / — estimate EST-1042$/.test(estimateEmailDefaults(mail).subject), "box sale send: the subject says quote (Jeff 2026-10-21); a normal estimate keeps estimate");
  const bid = { projectName: "Gym", estimateNumber: "EST-1042", senderName: "Sam Mills" };
  ok(bidderEmailDefaults({ ...bid, boxSale: true }).body.includes("You can also view it online here: {link}") && !bidderEmailDefaults({ ...bid, boxSale: true }).body.includes("full package"),
    "box sale send: the bidder email drops \"full package\" too");
  ok(bidderEmailDefaults(bid).body === "Hello,\n\nAttached is our bid for Gym (EST-1042).\n\nYou can also view the full package online here: {link}\n\nLet me know if you have any questions.\n\nThanks,\nSam Mills",
    "box sale send: a normal bidder email is unchanged");

  const spec = { sections: [sys("s1", "Rigging", [line(1), line(9, { option: true, desc: "Spare clamp" })], { presentation: "narrative", narrative: "Intro.", clientGoals: "Safer flying." })], mobs: [], document: DOC };
  const doc = quoteDocumentDataFor(quoteFixture({ boxSale: true, spec }), null, SET);
  const plainDoc = quoteDocumentDataFor(quoteFixture({ spec }), null, SET);
  const input = {
    photos: {}, catalog: new Map(), frozen: { coverSummary: "Our summary.", notIncluded: "Electrical\nPermits" },
    state: { kind: "ok", rev: { rev: 1 }, closed: false, won: false } as never, headerLine: "EST-1 · Rev 1", currentHref: null, view: "narrative" as const, base: "/b", letterheadSrc: "/lh.jpg",
  };
  const boxM = packageViewModel({ ...input, doc, boxSale: true });
  const plainM = packageViewModel({ ...input, doc: plainDoc });
  ok(boxM.boxSale === true && boxM.view === "bom" && boxM.summary === "" && boxM.notIncluded.length === 0 && !("document" in boxM) &&
     boxM.scopes.every((s) => s.goals === "" && s.intro.length === 0 && s.keyProducts.length === 0 && s.fallback === null && s.bom.length > 0),
    "box sale package page: the itemized list only — BOM view, no summary, goals, narrative, key products, document or Not included");
  ok(boxM.options.length > 0 && boxM.options.length === plainM.options.length && boxM.totals.total === plainM.totals.total && boxM.total === plainM.total,
    "box sale package page: prices, totals and add options stay");
  ok(!("boxSale" in plainM) && plainM.summary === "Our summary." && plainM.notIncluded.length === 2 && plainM.view === "narrative",
    "box sale package page: a normal estimate's page model is unchanged");
  const html = (m: typeof boxM) => renderToStaticMarkup(createElement(PackageView, { model: m }));
  ok(!html(boxM).includes('aria-label="Estimate view"') && html(plainM).includes('aria-label="Estimate view"'), "box sale package page: no Overview / Itemized toggle");
  const extras = {
    datasheets: { "SKU-1": { href: "/d", name: "DS" } }, downloads: { zipHref: "/z", datasheetsPdfHref: null, files: [], specifications: false },
    plans: [{ href: "/p", name: "P", kindLabel: "Plan", sizeLabel: "1 KB", isImage: false }], actions: { scopes: [] },
  };
  const bx = boxSaleExtras(extras);
  ok(Object.keys(bx.datasheets).length === 0 && bx.downloads === null && bx.plans.length === 0 && bx.actions === extras.actions,
    "box sale package page: no datasheet links, downloads or plans; the client actions (options, alternates, question) stay");

  const comp = rd("src/app/(app)/estimator/steps/send-composer.tsx");
  ok(comp.includes("useState<ComposerFields>(() => withoutCoverForBoxSale(composerInitial(null, packageSelection), boxSale))") && /\{!boxSale && \(\s*<label[^>]*>\s*<input type="checkbox" checked=\{fields\.attachCover\}/.test(comp),
    "box sale send (source): the composer starts without the cover and never offers it");
  ok(rd("src/app/(app)/estimator/send-actions.ts").includes("      boxSale: boxSaleOf(q),\n") && rd("src/app/(app)/estimator/bid-send-actions.ts").includes("senderName: user.name, signature, boxSale: boxSaleOf(q) }),"),
    "box sale send (source): both email defaults read the saved estimate's flag");
  const pkgPage = rd("src/app/share/quote/[id]/[token]/package-page.tsx");
  ok(pkgPage.includes("const box = revisionBoxSale(hit.rev);") && pkgPage.includes("const cut = await onlineCutSheets(hit.q, hit.rev);") && pkgPage.includes("buildPackageSlots(box ? boxSaleExtras(extras) : extras, {"),
    "box sale package page (source): the client link drops cut sheets, datasheet links, downloads and plans — from the revision's frozen flag");
  const live = rd("src/lib/estimate-output/package-live-loader.ts");
  ok(rd("src/lib/estimate-output/package-loader.ts").includes("boxSale: revisionBoxSale(hit.rev),") && live.includes("boxSale: boxSaleOf(q),") && live.includes("boxSaleOf(q) ? staffPackageExtras(null, false, [], q.id) : liveExtras(q),"),
    "box sale package page (source): the client page and the staff preview both build the box-sale model");
  ok(["src/app/share/quote/[id]/[token]/package.zip/route.ts", "src/app/share/quote/[id]/[token]/datasheets.pdf/route.ts"].every((f) => rd(f).includes("if (!pkg || revisionBoxSale(pkg.rev)) return notFound();")),
    "box sale package page (source): the zip and the datasheet book are a 404 for a box sale");
  ok(/\{!m\.boxSale && \(\s*<nav aria-label="Estimate view"/.test(rd("src/components/estimate-output/package-view.tsx")), "box sale package page (source): PackageView drops the toggle when the model says so");
}

function intakeChecks(ok: Ok) {
  const card = SERVICE_TYPES.find((t) => t.key === "box_sale");
  ok(!!card && card.label === BOX_SALE_COPY.label && card.sub === BOX_SALE_COPY.cardSub && SERVICE_TYPES[1]?.key === "box_sale" && isServiceType("box_sale"),
    "box sale intake: + New quote has a Box goods sale card, right after System / equipment quote");
  ok(BUILDER_BASE.box_sale === "/estimator" && builderPath("box_sale", "c1") === "/estimator?customer=c1&box=1" && !new URLSearchParams(builderPath("system", "c1").split("?")[1]).has("box"),
    "box sale intake: the card opens the Estimator with ?box=1 (a system quote never carries it)");
  ok(readHandoff({ box: "1" }).boxSale === true && readHandoff({}).boxSale === false && readHandoff({ box: "yes" }).boxSale === false, "box sale intake: the Estimator reads ?box=1 and nothing else");
  ok(quoteServiceType({ quoteType: "system", boxSale: true }) === "box_sale" && quoteServiceType({ boxSale: true, category: "Gear" }) === "box_sale" && quoteServiceType({ quoteType: "repair", boxSale: true }) === "repair" &&
     quoteEditPath({ id: "Q-1", boxSale: true }) === "/estimator?id=Q-1" && sameBuilder("box_sale", "system"),
    "box sale intake: a stored box sale reads as the Box goods sale card and edits in the Estimator (switching it to System is not a replace)");
  const act = rd("src/app/(app)/quotes/new/actions.ts");
  ok(act.includes('quoteType: input.type === "custom" || input.type === "box_sale" ? "system" : input.type,') && act.includes('...(input.type === "box_sale" ? { boxSale: true } : {}),'),
    "box sale intake (source): a draft minted from an Inbox thread is a system quote with the flag");
  const link = rd("src/lib/gmail/linking.ts");
  ok(link.includes("...(input.boxSale === true ? { boxSale: true } : {}),") && /boxSale\?: boolean;/.test(link), "box sale intake (source): linkThreadToNewQuote passes the flag to create");
  ok(rd("src/app/(app)/estimator/page.tsx").includes("if (!q && handoff?.boxSale) initial.boxSale = true;"), "box sale intake (source): a new estimate opened with ?box=1 starts with the switch on");
}


/** Final review (I1–I4 + minors) — behavioural where the code takes injected deps. */
async function finalReviewChecks(ok: Ok) {
  const SAM = { id: "u1", name: "Sam Mills", roles: ["Admin"] };
  const NOW = Date.UTC(2026, 9, 21, 18, 0, 0);
  const mk = (extra: Record<string, unknown> = {}) => quoteFixture({
    id: "Q-fr", name: "Gym", status: "draft", updatedAt: 77, estNo: 1042,
    pdf: { status: "ready", at: 20, savedAt: 20, blobPath: "quote-pdfs/Q-fr/cur.pdf" }, contentChangedAt: 10, revisions: [], ...extra,
  } as never);
  const fakes = (quote: Quote) => {
    const calls: string[] = [];
    const st = { q: quote, threads: [] as Array<{ attachments: Array<{ name: string }> }>, drafts: [] as Array<{ attachments: Array<{ name: string }> }> };
    const deps: EstimateEmailDeps = {
      now: () => NOW,
      getQuote: async (id) => (id === st.q.id ? st.q : null),
      readPdf: async (path) => { calls.push("readPdf:" + path); return Buffer.from("%PDF-estimate"); },
      renderCoverPdf: async () => { calls.push("renderCoverPdf"); return Buffer.from("%PDF-cover"); },
      storeCover: async (id, _b, now) => { calls.push("storeCover"); return `quote-pdfs/${id}/cover-${now}.pdf`; },
      findInboxDraft: async () => { calls.push("findInboxDraft"); return null; },
      claimSend: async (_id, by, now) => { calls.push("claimSend"); return { ok: true, claim: { by, until: now + 120_000 } }; },
      releaseSend: async () => { calls.push("releaseSend"); },
      applySignature: async (body) => { calls.push("applySignature"); return body; },
      sendQuote: async (_id, actor) => {
        calls.push("sendQuote");
        st.q = { ...st.q, status: "sent", revisions: [{ rev: 1, at: NOW, by: actor.name, reason: "sent", pdfBlobPath: "quote-pdfs/Q-fr/rev-1.pdf" }] } as never;
        return { ok: true };
      },
      ensureLink: async () => { calls.push("ensureLink"); return "https://app.test/share/x"; },
      createAndSendThread: async (spec) => { calls.push("createAndSendThread"); st.threads.push(spec as never); return { threadId: "C-1", delivery: "local" as const }; },
      createDraftThread: async (spec) => { calls.push("createDraftThread"); st.drafts.push(spec as never); return { threadId: "C-2" }; },
      recordEmail: async () => { calls.push("recordEmail"); return true; },
      addFollowUpTask: async () => { calls.push("addFollowUpTask"); },
      roster: async () => [{ id: "u1", name: "Sam Mills", status: "active" }],
    };
    return { deps, calls, st };
  };
  const input = (o: Record<string, unknown> = {}) => ({ to: "pat@school.org", cc: "", subject: "S", body: "B {link}", attachEstimate: true, attachCover: false, followUpDays: 0, asOf: 77, ...o });
  const laborSecs = { sections: [sys("s1", "Rigging", [line(1)]), sys("s2", "Install", [line(2, { labor: true })])], mobs: [], document: DOC };

  // I1a: a box sale with labor is never sent (send and Open in Inbox), before any claim / render / Gmail work.
  {
    const f = fakes(mk({ boxSale: true, spec: laborSecs }));
    const r = await sendEstimateEmail(f.deps, SAM, "Q-fr", input());
    ok(!r.ok && r.error === BOX_SALE_LABOR_MESSAGE && f.calls.length === 0 && f.st.q.status === "draft", "box sale final I1a: Send refuses a box sale with labor with the shared sentence — no claim, render, mark or Gmail work");
    const g = fakes(mk({ boxSale: true, spec: laborSecs }));
    const ri = await openEstimateInInbox(g.deps, SAM, "Q-fr", input());
    ok(!ri.ok && ri.error === BOX_SALE_LABOR_MESSAGE && g.calls.length === 0, "box sale final I1a: Open in Inbox refuses it too");
    const h = fakes(mk({ boxSale: true }));
    const rh = await sendEstimateEmail(h.deps, SAM, "Q-fr", input());
    ok(rh.ok && h.calls.includes("claimSend") && h.calls.includes("createAndSendThread"), "box sale final I1a: the same box sale without labor sends");
    const n = fakes(mk({ spec: laborSecs }));
    const rn = await sendEstimateEmail(n.deps, SAM, "Q-fr", input());
    ok(rn.ok, "box sale final I1a: a normal estimate with labor is untouched");
  }
  // I4: a box sale always attaches the estimate PDF, whatever is posted.
  {
    const f = fakes(mk({ boxSale: true }));
    const r = await sendEstimateEmail(f.deps, SAM, "Q-fr", input({ attachEstimate: false, attachCover: true }));
    const names = f.st.threads[0]?.attachments.map((a) => a.name) ?? [];
    ok(r.ok && names.length === 1 && names[0] === "EST-1042.pdf" && !f.calls.includes("renderCoverPdf"), "box sale final I4: attachEstimate false still attaches the estimate PDF (and never the cover)");
    const g = fakes(mk({ boxSale: true }));
    const ri = await openEstimateInInbox(g.deps, SAM, "Q-fr", input({ attachEstimate: false }));
    ok(ri.ok && (g.st.drafts[0]?.attachments.length ?? 0) === 1, "box sale final I4: Open in Inbox attaches it too");
    const n = fakes(mk());
    const rn = await sendEstimateEmail(n.deps, SAM, "Q-fr", input({ attachEstimate: false }));
    ok(rn.ok && (n.st.threads[0]?.attachments.length ?? 1) === 0, "box sale final I4: a normal estimate still honours an unticked Estimate PDF");
  }
  const comp = rd("src/app/(app)/estimator/steps/send-composer.tsx");
  ok(/checked=\{boxSale \|\| fields\.attachEstimate\} disabled=\{disabled \|\| boxSale\}/.test(comp) && comp.includes("The quote PDF is always attached."), "box sale final I4 (source): the composer's Estimate PDF tick is checked and disabled on a box sale, with the line");
  ok(rd("src/lib/estimate-email/send-server.ts").includes("boxSaleSaveProblem(boxSaleOf(q), (q.spec as { sections?: SpecSection[] } | null | undefined)?.sections)"), "box sale final I1a (source): preflight carries the labor refusal");

  // I1b: Move/Copy into an EXISTING box-sale estimate refuses labor.
  const act = rd("src/app/(app)/estimator/actions.ts");
  ok(/if \(boxSaleOf\(existing\)\) \{\s*const problem = boxSaleSaveProblem\(true, \[placed\]\);\s*if \(problem\) return \{ ok: false, error: problem \};/.test(act), "box sale final I1b (source): placeSystemInEstimate refuses a labor system into an existing box sale before the update");
  ok((act.match(/refusedSave\(/g) || []).length >= 3 && !act.includes("error: boxProblem,"), "box sale final minor (source): the save refusal shape is one helper");

  // I2: the online cut sheets follow the frozen flag.
  {
    const q = mk({ boxSale: true, pdfOptions: { detail: "sectioned", pdfCutSheets: true } });
    const box = { rev: 1, at: 10, docFields: { boxSale: true, pdfOptions: { detail: "sectioned", pdfCutSheets: true } } } as unknown as QuoteRevision;
    ok((await onlineCutSheets(q, box)) === null, "box sale final I2: onlineCutSheets is null for a box-sale revision, even with Cut sheets asked for");
  }
  const pkgPage = rd("src/app/share/quote/[id]/[token]/package-page.tsx");
  ok(pkgPage.includes("const cut = await onlineCutSheets(hit.q, hit.rev);") && rd("src/lib/curtain-cut-sheets/online.ts").includes("if (revisionBoxSale(rev)) return null;"), "box sale final I2 (source): the gate lives in onlineCutSheets; the package page no longer repeats it");

  // I3: the hub menu entry.
  const ctl = rd("src/app/(app)/quotes/controls.tsx");
  ok(/System \/ equipment quote[\s\S]{0,400}<\/Link>\s*<Link\s+href="\/quotes\/new\?type=box_sale"/.test(ctl) && ctl.includes("{BOX_SALE_COPY.label}") && ctl.includes("{BOX_SALE_COPY.cardSub}"), "box sale final I3 (source): + New quote's menu lists Box goods sale right after System / equipment quote");

  // Minor: the Change type hint.
  ok(boxSwitchHint("box_sale", "system") === "Use the Box goods sale switch in the Estimator's Quote details." && boxSwitchHint("system", "box_sale") === boxSwitchHint("box_sale", "system") &&
     boxSwitchHint("system", "system") === null && boxSwitchHint("box_sale", "box_sale") === null && boxSwitchHint("flame_test", "system") === null && boxSwitchHint("box_sale", "flame_test") === null,
    "box sale final minor: Change type between System and Box goods sale hints at the Estimator's switch");
  ok(rd("src/app/(app)/quotes/new/intake-form.tsx").includes("boxSwitchHint("), "box sale final minor (source): the intake shows the hint");

  // Minor: portal-sourced quotes can't be box sales.
  ok(isBoxSaleSource(undefined) && isBoxSaleSource(null) && isBoxSaleSource("estimator") && !isBoxSaleSource("portal-catalog") && !isBoxSaleSource("portal-service"), "box sale final minor: only an Estimator-source quote can be a box sale");
  ok(!boxSaleOf({ boxSale: true, source: "portal-catalog" }) && boxSaleOf({ boxSale: true, source: "estimator" }) && !boxSaleForSave({ source: "portal-catalog" }, true) && boxSaleForSave({ source: "estimator" }, true),
    "box sale final minor: boxSaleOf / boxSaleForSave drop the flag on a portal-catalog quote");
  ok(!("boxSale" in buildQuote("Q-x", { boxSale: true, source: "portal-catalog" }, "system", null, 1)) && buildQuote("Q-x", { boxSale: true, source: "estimator" }, "system", null, 1).boxSale === true,
    "box sale final minor: buildQuote drops the flag for a portal source");
  ok(rd("src/lib/stores/quotes.ts").includes("isBoxSaleSource(clean.source ?? q.source)"), "box sale final minor (source): update() drops the flag for a portal source");
  ok(/const canBoxSale = isBoxSaleQuoteType\(initial\.quoteType\) && isBoxSaleSource\(initial\.bonusSource\);/.test(rd("src/app/(app)/estimator/use-estimator-state.ts")), "box sale final minor (source): the switch is offered on Estimator-source quotes only");
}

// (later tasks: check functions above this line)

export async function boxSalePureChecks(ok: Ok) {
  dataChecks(ok);
  documentChecks(ok);
  wiringChecks(ok);
  printChecks(ok);
  buildUiChecks(ok);
  packageReviewChecks(ok);
  sendPackageChecks(ok);
  intakeChecks(ok);
  await finalReviewChecks(ok);
  // (later tasks: pure checks above this line)
}

export async function boxSaleDbChecks(ok: Ok) {
  await storeDbChecks(ok);
  await printDbChecks(ok);
  // (later tasks: DB checks above this line)
}

if (process.argv[1]?.endsWith("test-box-sale.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  const db = !!process.env.PGLITE_PATH;
  boxSalePureChecks(okf)
    .then(() => (db ? boxSaleDbChecks(okf) : undefined))
    .then(() => { console.log(`${pass} PASS, ${fail} FAIL${db ? "" : " (pure only — set PGLITE_PATH for the DB half)"}`); process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); process.exit(1); });
}

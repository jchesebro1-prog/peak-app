/* Stage 3 removal — checks for the small helpers that were moved out of the deleted Assessments engine, portal and
   service-quote modules and are still used by kept features (sourcing report CSV, booth card photos, company / venue
   short codes, assembly names, the client-response card guard, the Estimator's price rounding, stored portal quotes).
   The assertions are the ones the deleted suites held, ported to the new module paths. Pure: no database.
   Run alone with `npx tsx scripts/test-moved-helpers.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./ok-type";
import { csvCell, toCsv } from "../src/lib/csv";
import { scaledSize, photoFileProblem, HEIC_MESSAGE, PHOTO_CAPS } from "../src/lib/photo-resize";
import { CODE_RE } from "../src/lib/identity/short-code";
import { capGraphemes, INVISIBLE_STRIP } from "../src/lib/text-caps";
import { isInternalCategory } from "../src/lib/catalog-internal";
import { looksLikeCardNumber } from "../src/lib/card-number";
import { ceilToStep, roundToStep, normalizePriceOverride, typedPriceWarning, PRICE_STEP, PRICE_OVERRIDE_MAX } from "../src/lib/price-rounding";
import { clearPricedPor, sourceForSave } from "../src/lib/portal-legacy";
import { hasNoBuilder, quoteBuilderHref, estimatorShouldRedirect } from "../src/lib/quote-links";
import { pdfKindForQuoteType, canHavePdf } from "../src/lib/quote-pdf/state";
import { REVIEW_KINDS, REVIEW_KINDS_SHOWN, reviewKindOf } from "../src/lib/review-limits";
import { SYNCABLE_COLLECTIONS, DOC_TABLES } from "../src/db/doc-tables";
import { FIELD_COLLECTIONS } from "../src/lib/sync/engine";
import { CONFIG_COLLECTIONS, DEMO_COLLECTIONS } from "../src/db/seed-data";
import { NAV, activeKeyFor } from "../src/components/nav/nav-data";
import { optionalPartFields } from "../src/app/(app)/catalog/part-form";
import { sanitizeFixtureInput } from "../src/lib/fixture-assemblies";
import type { SpecItem, SpecSection } from "../src/app/(app)/estimator/types";

const ROOT = process.cwd();
const rd = (p: string) => readFileSync(join(ROOT, p), "utf8");

export async function movedHelperChecks(ok: Ok) {
  // csv (sourcing report): formula-injection guard, quoting, BOM + CRLF
  ok(csvCell("=SUM(A1)") === "'=SUM(A1)" && csvCell("-3") === "'-3" && csvCell("+1") === "'+1" && csvCell("@x") === "'@x" && csvCell('a,"b"') === '"a,""b"""' && csvCell(null) === "" && csvCell(5) === "5" && csvCell("line\nbreak") === '"line\nbreak"', "csv: formula guard + quoting");
  ok(csvCell("=a,b") === "\"'=a,b\"" && csvCell("\tx") === "'\tx" && csvCell("\rx") === "\"'\rx\"", "csv: guarded and quoted together");
  ok(toCsv(["a"], [["x"]]).startsWith("﻿") && toCsv(["a"], [["x"]]).includes("\r\n") && toCsv(["a", "b"], [["x", "=1"]]) === "﻿a,b\r\nx,'=1\r\n", "csv: BOM + CRLF");
  ok(csvCell(-3) === "-3" && csvCell(-0.5) === "-0.5" && csvCell(true) === "true" && csvCell(0) === "0", "csv: numbers are never guarded, strings are");
  ok(toCsv(["a"], [[-3]]) === "﻿a\r\n-3\r\n" && toCsv(["a"], [["-3"]]) === "﻿a\r\n'-3\r\n" && toCsv(["a"], [["x"]]).charCodeAt(0) === 0xfeff, "csv: BOM is U+FEFF; a numeric -3 stays -3");
  ok(rd("src/lib/sourcing-report.ts").includes('from "@/lib/csv"'), "csv (source): the sourcing report imports the moved module");

  // photo resize (booth card photo)
  const sz = (w: number, h: number) => JSON.stringify(scaledSize(w, h, 1600));
  ok(sz(4000, 3000) === '{"width":1600,"height":1200}' && sz(3000, 4000) === '{"width":1200,"height":1600}' && sz(800, 600) === '{"width":800,"height":600}' && sz(1600, 1600) === '{"width":1600,"height":1600}', "photo resize: long edge scales to 1600, never upscales");
  ok(sz(10000, 1) === '{"width":1600,"height":1}' && sz(0, 0) === '{"width":1,"height":1}', "photo resize: a sliver keeps at least 1 px");
  const fp = (name: string, type: string, size: number) => photoFileProblem({ name, type, size });
  ok(fp("a.jpg", "image/jpeg", 1000) === null && fp("a.png", "image/png", 1000) === null && fp("a", "", 1000) === null, "photo file: images (and an untyped camera file) are fine");
  ok(fp("a.heic", "image/heic", 10) === HEIC_MESSAGE && fp("IMG.HEIF", "", 10) === HEIC_MESSAGE && HEIC_MESSAGE === "HEIC isn't supported — set the camera to Most Compatible", "photo file: HEIC is refused with the camera hint");
  ok(fp("a.pdf", "application/pdf", 10) !== null && fp("a.jpg", "image/jpeg", 25 * 1024 * 1024 + 1) !== null && fp("a.jpg", "image/jpeg", 25 * 1024 * 1024) === null, "photo file: non-images and files over 25 MB are refused");
  ok(PHOTO_CAPS.originalBytes === 25 * 1024 * 1024 && PHOTO_CAPS.longEdge === 1600 && PHOTO_CAPS.quality === 0.8, "photo resize: the caps are unchanged by the move");
  ok(rd("src/app/(app)/leads/booth/booth-form.tsx").includes('from "@/lib/photo-resize"'), "photo resize (source): Booth mode imports the moved module");

  // short codes (companies.short_code / sites.short_code validation)
  ok(CODE_RE.test("MPSD") && !CODE_RE.test("mp") && !CODE_RE.test("TOOLONG7") && !CODE_RE.test("A") && CODE_RE.test("LIN2"), "codes: validation");

  // name clean-up helpers (assembly names)
  ok(capGraphemes("abcdef", 3) === "abc" && capGraphemes("ab", 5) === "ab" && Array.from(capGraphemes("a👨‍👩‍👧b", 2)).length <= 2, "text caps: capGraphemes never splits a cluster and respects the cap");
  ok("a​b‮c﻿d".replace(INVISIBLE_STRIP, "") === "abcd", "text caps: INVISIBLE_STRIP drops zero-width, bidi and BOM characters");

  // internal catalog rows
  ok(isInternalCategory("Labor") && isInternalCategory(" labor ") && !isInternalCategory("Lighting") && !isInternalCategory(undefined), "catalog: the Labor category is internal (case-insensitive, trimmed)");

  // card-number guard (client responses)
  ok(looksLikeCardNumber("4111 1111 1111 1111") && looksLikeCardNumber("PO 12345 4111-1111-1111-1111") && !looksLikeCardNumber("PO 12345") && !looksLikeCardNumber("1234567890123456"), "card guard: a Luhn-valid 13–19 digit run is caught, a PO number is not");

  // price rounding (the Estimator's system price, typed totals)
  ok(PRICE_STEP === 25 && PRICE_OVERRIDE_MAX === 10_000_000, "price rounding: step and ceiling unchanged");
  ok(roundToStep(821.43) === 825 && roundToStep(812.49) === 800 && roundToStep(812.5) === 825 && roundToStep(862.4999999999999) === 875 && roundToStep(Number.NaN) === 0, "price rounding: nearest $25, half rounds up");
  ok(ceilToStep(801) === 825 && ceilToStep(800) === 800 && ceilToStep(800.0000000001) === 800 && ceilToStep(Number.NaN) === 0 && ceilToStep(14, 10) === 20, "price rounding: ceilToStep goes up to the next step, exact multiples stay");
  ok(normalizePriceOverride("1,234.40") === 1234 && normalizePriceOverride("$900") === 900 && normalizePriceOverride(950) === 950 && [0, -5, 10_000_001, "abc", "", null, undefined, true, "0x10", "1e3", "-0.4"].every((v) => normalizePriceOverride(v) === undefined), "price rounding: a typed total is whole dollars, $1–$10,000,000");
  ok(typedPriceWarning(500, 575, (500 - 575) / 575)?.kind === "below-cost" && typedPriceWarning(600, 575, (600 - 575) / 575)?.kind === "low-markup" && typedPriceWarning(1200, 1000, 0.2) === null && typedPriceWarning(100, 0, 0) === null, "price rounding: a typed total below cost or under 11 % markup warns");

  // stored portal quotes
  ok(sourceForSave("portal-catalog", "estimator") === "portal-catalog" && sourceForSave("portal-service", "estimator") === "portal-service" && sourceForSave("grid", "estimator") === "estimator" && sourceForSave(null, "estimator") === "estimator" && sourceForSave(undefined, "estimator") === "estimator", "portal legacy: a stored portal source survives a save; anything else takes the builder's stamp");
  const item = (over: Partial<SpecItem>): SpecItem => ({ id: 1, sku: "X", desc: "x", qty: 1, unit: "ea", cost: 0, price: 0, ...over }) as SpecItem;
  const plain = item({ id: 3, price: 10 });
  const sec = { id: "s1", name: "S", items: [item({ id: 1, por: true, price: 50 }), item({ id: 2, por: true, price: 0 }), plain] } as unknown as SpecSection;
  const r1 = clearPricedPor([sec]);
  ok(!r1.sections[0].items[0].por && r1.sections[0].items[1].por === true && r1.sections[0].items[2] === plain && r1.anyPor === true, "portal legacy: clearPricedPor clears por once priced, keeps an unpriced line flagged, never touches a line without por");
  const untouched = { id: "s2", name: "T", items: [plain] } as unknown as SpecSection;
  ok(clearPricedPor([untouched]).sections[0] === untouched && clearPricedPor([untouched]).anyPor === false, "portal legacy: a section with no por line passes through object-identical");

  // old service quotes are rows only
  ok(["flame_test", "inspection", "repair", "rental"].every((t) => hasNoBuilder(t) && quoteBuilderHref({ id: "Q-1", quoteType: t }) === "/quotes?id=Q-1" && estimatorShouldRedirect({ id: "Q-1", quoteType: t })), "quote links: a flame / inspection / repair / rental quote opens its Quotes-hub row");
  ok(!hasNoBuilder("system") && !hasNoBuilder(null) && !hasNoBuilder("consulting") && quoteBuilderHref({ id: "Q 1" }) === "/estimator?id=Q%201" && quoteBuilderHref({ id: "Q-1", quoteType: "consulting" }) === "/design/engagements/quote?id=Q-1", "quote links: system and consulting quotes keep their builders");
  ok(pdfKindForQuoteType("system") === "quote" && pdfKindForQuoteType(null) === "quote" && pdfKindForQuoteType("flame_test") === null && pdfKindForQuoteType("inspection") === null && !canHavePdf("flame_test") && canHavePdf(undefined), "quote pdf: only a system estimate has a saved PDF");
  ok(reviewKindOf({ quoteType: "flame_test", flameTest: { priceOverride: 900 } }) === "flame_typed" && reviewKindOf({ quoteType: "inspection" }) === "inspection_auto" && REVIEW_KINDS.length === 10 && REVIEW_KINDS_SHOWN.map((k) => k.key).join() === "system_plain,system_labor,consulting", "review limits: old quote kinds still resolve; Settings shows only the kinds that can be built");
  const hub = rd("src/app/(app)/quotes/page.tsx"), ctl = rd("src/app/(app)/quotes/controls.tsx");
  ok(hub.includes("{!hasNoBuilder(q.quoteType) && (") && !ctl.includes("type=flame_test") && !ctl.includes("type=inspection") && ctl.includes("type=consulting"), "quotes hub (source): no builder button for a removed type, and + New quote lists neither flame test nor inspection");

  // controls that left with the portal and site visits — stored values are left alone
  const fd = new FormData();
  fd.set("portalVisibility", "hide");
  fd.set("mapPrice", "12");
  ok(!("portalVisibility" in optionalPartFields(fd)) && optionalPartFields(fd).mapPrice === 12, "catalog part form: a posted portalVisibility is ignored, so a save keeps whatever is stored (mergeUpsert only touches submitted keys)");
  const catalogPage = rd("src/app/(app)/catalog/page.tsx"), fixtureForm = rd("src/app/(app)/design/assemblies/fixture-form.tsx");
  ok(!catalogPage.includes("Customer visibility") && !catalogPage.includes('name="portalVisibility"') && !catalogPage.includes("/catalog/departments"), "catalog (source): no Customer visibility select and no Departments link");
  ok(!fixtureForm.includes("Portal category") && fixtureForm.includes("portalCategory: r.portalCategory || \"\"") && fixtureForm.includes("portalCategory: d.portalCategory"), "assemblies (source): no Portal category box; the draft still round-trips the stored category");
  const fx = sanitizeFixtureInput({ kind: "fixture", label: "Kept", description: "", portalCategory: " Lighting  packages ", lightEngineSku: "ENG-1", lensSku: "", lines: {} });
  ok(fx.ok && (fx.value as { portalCategory?: string }).portalCategory === "Lighting packages", "assemblies: a stored portal category survives the save rules (cleaned, not dropped)");
  const goals = rd("src/app/(app)/estimator/scope-output-fields.tsx"), drawer = rd("src/app/(app)/leads/lead-drawer.tsx"), leadActs = rd("src/app/(app)/leads/actions.ts");
  ok(goals.includes("Client goals") && goals.includes("clientGoals: v") && !goals.includes("From site visit") && !goals.includes("siteVisitGoalsAction"), "estimator (source): Client goals is a plain editable field — no From site visit pull");
  ok(!drawer.includes("Request site visit") && !drawer.includes("skipSurvey") && !leadActs.includes("canConvertLead") && leadActs.includes("export async function convertLeadAction("), "leads (source): Convert has no survey gate and the drawer offers no site-visit request");
  const docsCard = rd("src/components/documents/documents-card-client.tsx"), docsUp = rd("src/lib/documents-upload.ts");
  ok(!docsCard.includes("Shared — visible in the customer portal") && !docsCard.includes("Filter by visibility") && docsCard.includes("From customer") && docsUp.includes('visibility: "internal"') && docsUp.includes('source: "team"'), "documents (source): no sharing controls; a new upload is stored internal / team; an old customer upload keeps its chip");
  const qd = rd("src/app/(app)/estimator/quote-document.tsx");
  ok(qd.includes("To proceed, sign and return this quote.") && !qd.includes("customer portal"), "estimate document (source): the acceptance line no longer names a customer portal");

  // offline sync is booth-only; removed collections are registered and never wiped
  ok(SYNCABLE_COLLECTIONS.join() === "booth_captures" && [...FIELD_COLLECTIONS].join() === "booth_captures", "sync: booth captures are the only offline collection, on the server and the device alike");
  const gone = ["surveys", "site_visits", "flame_jobs", "inspections", "assessments", "findings", "venue_profiles", "portal_carts", "projects", "repair_jobs", "tasks", "comms", "meetings", "recordings", "assist_runs"] as const;
  ok(gone.every((c) => c in DOC_TABLES && CONFIG_COLLECTIONS.includes(c) && !DEMO_COLLECTIONS.includes(c)), "go-live wipe: every removed feature's collection stays registered and is on the keep-list");
  ok(DEMO_COLLECTIONS.includes("quotes") && DEMO_COLLECTIONS.includes("leads") && DEMO_COLLECTIONS.includes("booth_captures"), "go-live wipe: live business collections are still cleared");

  // nav + public routes
  const keys = NAV.flatMap((e) => (e.kind === "group" ? e.children.map((c) => c.key) : [e.key]));
  const hrefs = NAV.flatMap((e) => (e.kind === "group" ? e.children.map((c) => c.href) : [e.href]));
  ok(!NAV.some((e) => e.key === "pm") && ["flametests", "inspections", "field", "assessments", "portal-quotes"].every((k) => !keys.includes(k)) && !hrefs.some((h) => /^\/(flame-tests|inspections|venue-assessments|assessments|portal)|\/quotes\/portal/.test(h)), "nav: no Service group and no flame test, inspection, assessment or portal entry");
  ok(activeKeyFor("/quotes/portal") === "quotes" && activeKeyFor("/flame-tests") === "" && activeKeyFor("/leads/booth") === "leads" && activeKeyFor("/catalog/manufacturers") === "catalog", "nav: removed routes light nothing of their own; kept routes are unchanged");
  const mw = rd("src/middleware.ts");
  const matcher = /matcher:\s*\[\s*"([^"]+)"/.exec(mw)?.[1] ?? "";
  ok(!/\|portal\|/.test(matcher) && /\|share\/\|/.test(matcher) && /\|d\/ds\/\|/.test(matcher) && /\|print\/\|/.test(matcher) && /api\/booth\/share-back/.test(matcher) && /\|c\/\|/.test(matcher), "middleware: /portal is no longer public; the share page, datasheet links, print routes and the booth card stay public");
}

if (process.argv[1]?.endsWith("test-moved-helpers.ts")) {
  let fails = 0, n = 0;
  const ok: Ok = (c, m) => { n++; if (!c) { fails++; console.log("FAIL", m); } };
  movedHelperChecks(ok).then(() => { console.log(fails ? `${fails} FAILED` : `moved helpers: ALL PASSED (${n} checks)`); process.exit(fails ? 1 : 0); });
}

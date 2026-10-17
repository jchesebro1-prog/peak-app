/* Estimate photo wrap, model tags, title page, drawings + datasheet links
   (docs/superpowers/specs/2026-10-16-estimate-photo-wrap-title-page-design.md) — harness checks.
   `photoWrapPureChecks` needs no database; `photoWrapDbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-photo-wrap.ts`. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import sharp from "sharp";
import type { Ok } from "./test-inbox-org";
import { spreadPhotoAnchors, photoFigureStyle, photoImgStyle, photoTagStyle, PHOTO_TAG_BG, docPhotoFigureStyle, docPhotoImgStyle } from "../src/lib/estimate-output/photo-spread";
import { cleanTag, photoTagText, keyProductModelsFor, PHOTO_TAG_MAX } from "../src/lib/estimate-output/photo-models";
import { lineOwnModel } from "../src/lib/catalog-rename/sku";
import type { SpecSection } from "../src/app/(app)/estimator/types";
import { qd293Props, qd293Sections, quoteDocumentModule293, renderQuoteDocument293 } from "./qd293-cases";
import { printableKeyProducts } from "../src/app/(app)/estimator/narrative";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { packageViewModel } from "../src/lib/estimate-output/package-model";
import PackageView, { PACKAGE_LEFT_PHOTO_CSS, PACKAGE_WEB_CSS } from "../src/components/estimate-output/package-view";
import { photoModelOf, resolvePackageDoc } from "../src/lib/package-doc/resolve";
import PackageDocView, { PACKAGE_DOC_CSS } from "../src/components/package-doc/package-doc-view";
import { editorPhotoTag } from "../src/components/package-doc/editor/editor-model";
import { datasheetLinkPath, datasheetLinkSig, verifyDatasheetLinkSig, DATASHEET_SIG_RE } from "../src/lib/estimate-output/datasheet-link";
import { serveEstimateDatasheet } from "../src/lib/estimate-output/datasheet-link-server";
import { inlineDisposition } from "../src/lib/document-files";
import { datasheetLinkRows } from "../src/lib/estimate-output/datasheet-links";
import DatasheetLinksPage, { DATASHEET_LINKS_CSS } from "../src/components/estimate-output/datasheet-links-page";
import { planDrawings, imagePagePlacement, pdfNotesOf, drawingSkipNote, drawingsBudget, appendixLeftOutNote, APPENDIX_COPY, PDF_NOTES_MAX, ESTIMATE_PDF_TARGET_MAX_BYTES } from "../src/lib/quote-pdf/appendix-plan";
import { mergeEstimateAppendices, prepareDrawings, prepareDrawingImage, DRAWING_IMAGE_DPI } from "../src/lib/quote-pdf/appendix-merge-server";
import { PDF_NOTES_MAX as STATE_NOTES_MAX } from "../src/lib/quote-pdf/state";
import { appendixFits, generateQuotePdf } from "../src/lib/quote-pdf/generate";
import { pdfView, settlePdf } from "../src/lib/quote-pdf/state";
import { pdfBanner } from "../src/components/quote-pdf/pdf-banner";
import { ESTIMATE_EMAIL_ATTACH_MAX } from "../src/lib/estimate-email/compose";
import { pdfStorage } from "../src/lib/quote-pdf/storage";
import { buildQuote, get as getQuote, updateQuotePdf } from "../src/lib/stores/quotes";
import { quotePathSegment } from "../src/lib/estimate-output/package-files";
import { loadDatasheetLinkRows } from "../src/lib/estimate-output/datasheet-links-server";
import { createFixture, dropFixtures, fixtureId, registerFixture } from "./test-fixtures";
import { pdfAppendixKey } from "../src/lib/quote-pdf/appendix-key";

export const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function spreadChecks(ok: Ok) {
  ok(JSON.stringify(spreadPhotoAnchors(3, 2)) === "[0,1]", "photo wrap: photo k anchors before unit k");
  ok(JSON.stringify(spreadPhotoAnchors(2, 4)) === "[0,1,1,1]", "photo wrap: photos past the last unit stack before the last unit");
  ok(JSON.stringify(spreadPhotoAnchors(0, 2)) === "[0,0]", "photo wrap: no units → every photo anchors at 0");
  ok(JSON.stringify(spreadPhotoAnchors(5, 0)) === "[]" && JSON.stringify(spreadPhotoAnchors(NaN, -1)) === "[]", "photo wrap: no photos (or junk counts) → no anchors");
  const r = photoFigureStyle("right"), l = photoFigureStyle("left"), f = photoFigureStyle("full", 60);
  ok(r.float === "right" && r.width === "34%" && r.margin === "0 0 8px 14px" && r.position === "relative" && r.breakInside === "avoid",
    "photo wrap: a right figure keeps #293's float, 34 % and the 14px gutter, and is the tag's positioning box");
  ok(l.float === "left" && l.margin === "0 14px 8px 0", "photo wrap: a left figure mirrors it");
  ok(f.float === undefined && f.display === "block" && f.width === "60%" && f.margin === "0 auto 10px", "photo wrap: a full figure is a centred block at its width");
  const img = photoImgStyle("right");
  ok(img.display === "block" && img.width === "100%" && img.maxHeight === "2.4in" && img.objectFit === "contain" && img.objectPosition === "right top" &&
     photoImgStyle("left").objectPosition === "left top" && photoImgStyle("full", "4in").maxHeight === "4in" && photoImgStyle("full").objectPosition === "center top",
    "photo wrap: the image fills its figure, height-capped, pushed to the outer side so the corner tag sits on it");
  const tr = photoTagStyle("right", 9), tl = photoTagStyle("left", 10), tf = photoTagStyle("full");
  ok(tr.position === "absolute" && tr.bottom === 0 && tr.right === 0 && tr.left === undefined && tr.background === PHOTO_TAG_BG && PHOTO_TAG_BG === "rgba(22,24,29,.86)" &&
     tr.color === "#fff" && tr.fontSize === 9 && tr.padding === "2px 6px" && tr.maxWidth === "100%" && tr.whiteSpace === "nowrap" && tr.textOverflow === "ellipsis" && tr.overflow === "hidden",
    "photo wrap: the tag is a dark mono label on the outer bottom corner, one line, ellipsis");
  ok(tl.left === 0 && tl.right === undefined && tl.fontSize === 10 && tf.right === 0 && tf.fontSize === undefined,
    "photo wrap: a left photo's tag sits bottom-left; a full image's bottom-right; no font size → CSS decides");
}

function modelChecks(ok: Ok) {
  ok(lineOwnModel({ manufacturerModelNumber: " ION-XE ", manufacturerPartNumber: "7410A" }) === "ION-XE" && lineOwnModel({ manufacturerPartNumber: "7410A" }) === "7410A" &&
     lineOwnModel({ sku: "ETC:ION" }) === "" && lineOwnModel(null) === "", "photo wrap: a line's own model is its Model #, else its MFR P/N, never its SKU");
  ok(cleanTag("  Jupiter\n 4 ") === "Jupiter 4" && cleanTag(null) === "" && cleanTag("x".repeat(80)).length === PHOTO_TAG_MAX, "photo wrap: tag text is one trimmed line, capped");
  ok(photoTagText({ ownPhoto: true, partModel: "Jupiter 4", ownModel: "80-0043" }) === "Jupiter 4", "photo wrap: an own photo prints the part-aware model");
  ok(photoTagText({ ownPhoto: true, partModel: null, ownModel: "80-0043" }) === "80-0043", "photo wrap: an own photo with no part read falls back to the line's own model");
  ok(photoTagText({ ownPhoto: false, partModel: "Jupiter 4", ownModel: "" }) === "", "photo wrap: a placeholder with no real model on the line gets no tag");
  ok(photoTagText({ ownPhoto: false, partModel: "Jupiter 4", ownModel: "SW-ALLOW-1" }) === "SW-ALLOW-1", "photo wrap: a placeholder tags only with the line's own model");

  const sections = [
    { id: "s1", name: "Audio", kind: "materials", mfr: "", freightPct: 0, presentation: "narrative", narrative: "",
      items: [
        { id: 1, sku: "Symetrix:Jupiter 4", desc: "DSP", qty: 1, unit: "ea", cost: 1, price: 2 },
        { id: 2, sku: "ETC:CS-SPOT", desc: "Spot", qty: 1, unit: "ea", cost: 1, price: 2, manufacturerModelNumber: "CS Spot Jr" },
        { id: 3, sku: "NOPART", desc: "Gone", qty: 1, unit: "ea", cost: 1, price: 2 },
      ],
      keyProducts: [
        { lineKey: "1", sku: "Symetrix:Jupiter 4", text: "", photo: true },
        { lineKey: "2", sku: "ETC:CS-SPOT", text: "", photo: true },
        { lineKey: "3", sku: "NOPART", text: "", photo: true },
      ] },
    { id: "s2", name: "Rig", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 9, sku: "ASM-1", desc: "Assembly", qty: 1, unit: "ea", cost: 1, price: 2 }] },
  ] as unknown as SpecSection[];
  const doc = { type: "doc", version: 1, content: [{ type: "productImage", attrs: { sectionId: "s2", lineKey: "9", sku: "ASM-1", align: "auto", width: 34 } }] } as never;
  const parts = new Map([
    ["Symetrix:Jupiter 4", { sku: "Symetrix:Jupiter 4", manufacturerModelNumber: "Jupiter 4", manufacturerPartNumber: "80-0043" }],
    ["ETC:CS-SPOT", { sku: "ETC:CS-SPOT", manufacturerModelNumber: "CS Spot" }],
    ["ETC:MEMBER", { sku: "ETC:MEMBER", manufacturerPartNumber: "7460A1001" }],
  ]);
  const m = keyProductModelsFor({ sections, document: doc, skus: ["Symetrix:Jupiter 4", "ETC:CS-SPOT", "NOPART", "ASM-1", "line:4", "__proto__"], parts, readSku: (s) => (s === "ASM-1" ? "ETC:MEMBER" : s) });
  ok(m["Symetrix:Jupiter 4"] === "Jupiter 4", "photo wrap: models → the catalog part's Model # (never the order #)");
  ok(m["ETC:CS-SPOT"] === "CS Spot Jr", "photo wrap: models → the line's own frozen Model # wins over the part's");
  ok(!Object.hasOwn(m, "NOPART") && !Object.hasOwn(m, "line:4") && !Object.hasOwn(m, "__proto__"), "photo wrap: models skip a sku with no live part, line tokens and __proto__");
  ok(m["ASM-1"] === "7460A1001", "photo wrap: an assembly line (package-doc anchor) reads its aliased member part");
}

function wrapSections(): SpecSection[] {
  return qd293Sections().map((s) =>
    s.id === "s2"
      ? {
          ...s,
          narrative: "Para one.\n\nPara two.\n\nPara three.",
          items: s.items.map((it) => (it.id === 6 ? { ...it, manufacturerPartNumber: "PN-6" } : it)),
          keyProducts: [
            { lineKey: "5", sku: "SKU-5", text: "Five.", photo: true },
            { lineKey: "6", sku: "SKU-6", text: "Six.", photo: true },
          ],
        }
      : s
  );
}
const PHOTOS = { "SKU-5": { src: "data:image/png;base64,QUFB", alt: "Five" }, "SKU-6": { src: "data:image/png;base64,QkJC", alt: "Six" } };

function quoteDocPhotoChecks(ok: Ok) {
  const html = renderQuoteDocument293({ ...qd293Props({ sections: wrapSections() }), keyProductPhotos: PHOTOS, keyProductModels: { "SKU-5": "Jupiter 4" } });
  const f1 = html.indexOf('<figure class="est-ph"'), f2 = html.indexOf('<figure class="est-ph"', f1 + 1);
  const p1 = html.indexOf(">Para one.<"), p2 = html.indexOf(">Para two.<"), p3 = html.indexOf(">Para three.<");
  ok(f1 > 0 && f2 > 0 && f1 < p1 && p1 < f2 && f2 < p2 && p2 < p3 && html.indexOf('<figure class="est-ph"', f2 + 1) === -1,
    "photo wrap (doc): photo 1 sits at the first paragraph, photo 2 at the next — the system narrative wraps them");
  ok(/<figure class="est-ph" style="float:right;width:34%;margin:0 0 8px 14px;position:relative;break-inside:avoid">/.test(html.slice(f1)) &&
     /^<figure class="est-ph" style="float:left;width:34%;margin:0 14px 8px 0/.test(html.slice(f2)),
    "photo wrap (doc): sides still alternate right, left");
  ok(html.slice(f1, f2).includes('class="est-ph-tag"') && html.slice(f1, f2).includes(">Jupiter 4</span>") && html.slice(f1, f2).includes("font-size:9px") &&
     html.slice(f2, p2).includes(">PN-6</span>") && html.slice(f2, p2).includes("left:0"),
    "photo wrap (doc): each photo carries its model tag on the outer bottom corner (9px in print); no part read → the line's own model");
  ok((html.match(/class="est-kp" style="margin-top:12px"/g) || []).length === 2 && !/class="est-kp" style="display:flow-root/.test(html),
    "photo wrap (doc): a key product is a plain block (no longer its own float box)");
  const sysDiv = html.lastIndexOf("<div", f1);
  ok(html.slice(sysDiv, f1).includes("display:flow-root"), "photo wrap (doc): the system body is the float container");
  const plain = renderQuoteDocument293(qd293Props());
  ok(!plain.includes("display:flow-root") && !plain.includes("est-ph"), "photo wrap (doc): a system with no photo renders with no float container");
  const web = renderQuoteDocument293({ ...qd293Props({ sections: wrapSections() }), keyProductPhotos: PHOTOS, keyProductModels: { "SKU-5": "Jupiter 4" }, layout: "web" });
  ok(/class="est-ph-tag" style="[^"]*font-size:10px[^"]*">Jupiter 4<\/span>/.test(web) && !/class="est-ph-tag" style="[^"]*font-size:9px/.test(web),
    "photo wrap (doc): the web tag is 10px");
  const noModels = renderQuoteDocument293({ ...qd293Props({ sections: wrapSections().map((s) => ({ ...s, items: s.items.map((it) => ({ ...it, manufacturerPartNumber: undefined })) })) }), keyProductPhotos: PHOTOS });
  ok(noModels.includes('<figure class="est-ph"') && !noModels.includes("est-ph-tag"), "photo wrap (doc): no model anywhere → no tag");

  // Placeholders: an allowance block prints its placeholder; tagged only with the line's own model.
  const allow = (own?: string) => qd293Sections().map((s) =>
    s.id === "s2" ? { ...s, items: [...s.items, { id: 12, sku: "ALLOW-1", desc: "Rigging allowance", qty: 1, unit: "ls", cost: 1, price: 2, allowance: true, ...(own ? { manufacturerModelNumber: own } : {}) }],
      keyProducts: [{ lineKey: "12", sku: "ALLOW-1", text: "", photo: true }] } : s) as SpecSection[];
  const a0 = renderQuoteDocument293({ ...qd293Props({ sections: allow() }), keyProductPhotos: {}, keyProductModels: { "ALLOW-1": "SHOULD-NOT-PRINT" } });
  const a1 = renderQuoteDocument293({ ...qd293Props({ sections: allow("AL-500") }), keyProductPhotos: {} });
  ok(a0.includes("/placeholders/allowance.webp") && !a0.includes("est-ph-tag") && a1.includes(">AL-500</span>"),
    "photo wrap (doc): a placeholder is tagged only when its line has a real model number");
  ok(printableKeyProducts(allow("AL-500").find((s) => s.id === "s2")!)[0].ownModel === "AL-500" && !("ownModel" in printableKeyProducts(allow().find((s) => s.id === "s2")!)[0]),
    "photo wrap (doc): printable key products carry the line's own model only when it has one");

  const { QUOTE_PRINT_CSS } = quoteDocumentModule293();
  const webCss = (quoteDocumentModule293() as unknown as { QUOTE_WEB_CSS: string; QUOTE_WEB_EMBED_CSS: string });
  ok(QUOTE_PRINT_CSS.includes(".est-doc .est-kp { break-inside: avoid; page-break-inside: avoid; }") && QUOTE_PRINT_CSS.includes(".est-doc .est-ph { break-inside: avoid; page-break-inside: avoid; }"),
    "photo wrap (doc): print keeps a product heading with its lines and never splits a photo");
  for (const css of [webCss.QUOTE_WEB_CSS, webCss.QUOTE_WEB_EMBED_CSS])
    ok(/@media \(max-width: 480px\)[\s\S]*\.est-web \.est-ph \{ float: none !important; display: block; width: 100% !important; margin: 0 0 10px 0 !important; \}/.test(css) && !css.includes(".est-kp img"),
      "photo wrap (doc): a phone puts each photo full width (web + embedded CSS)");
  for (const css of [webCss.QUOTE_WEB_CSS, webCss.QUOTE_WEB_EMBED_CSS]) {
    const phone = css.slice(css.indexOf("@media (max-width: 480px)"));
    ok(phone.includes(".est-web .est-ph-tag { left: auto !important; right: 0 !important; }") && phone.includes(".est-web .est-ph img { max-height: 3in !important; object-position: right top !important; }") &&
       phone.indexOf(".est-ph-tag") < phone.indexOf("@media print"),
      "photo wrap (doc): on a phone the full-width photo's tag sits bottom-right, on the picture's corner (web + embedded CSS)");
  }

  const pr = rd("src/app/print/quote/[id]/page.tsx"), loader = rd("src/lib/quote-pdf/document-loader.ts");
  ok(pr.includes("loadKeyProductModels(doc.sections, doc.document)") && loader.includes("loadKeyProductModels(doc.sections, doc.document)") && pr.includes("keyProductModels={keyProductModels}"),
    "photo wrap (doc): the print route and the portal/share loader read the models beside the photos");
}

function packagePagePhotoChecks(ok: Ok) {
  const doc = qd293Props({ sections: wrapSections() });
  const model = packageViewModel({ doc, photos: PHOTOS, models: { "SKU-5": "Jupiter 4" }, catalog: new Map(), frozen: { coverSummary: "", notIncluded: "" },
    state: { kind: "ok", rev: { rev: 1 }, closed: false, won: false } as never, headerLine: "EST-1 · Rev 1", currentHref: null, view: "narrative", base: "/b", letterheadSrc: "/lh.jpg" });
  const s2 = model.scopes.find((s) => s.id === "s2")!;
  ok(s2.keyProducts[0].model === "Jupiter 4" && s2.keyProducts[1].model === "PN-6" && s2.keyProducts[1].side === "left", "photo wrap (package): key products carry their tag text and side");
  const html = renderToStaticMarkup(createElement(PackageView, { model, slots: { keyProductExtra: { "SKU-5": createElement("a", { href: "/ds" }, "Datasheet") } } }));
  const body = html.slice(html.indexOf('data-scope="s2"'));
  const f1 = body.indexOf('<figure class="pkg-ph"'), f2 = body.indexOf('<figure class="pkg-ph pkg-ph-left"');
  ok(body.includes('<div class="pkg-body pkg-body-ph">') && f1 > 0 && f1 < body.indexOf(">Para one.<") && body.indexOf(">Para one.<") < f2 && f2 < body.indexOf(">Para two.<"),
    "photo wrap (package): photos spread down the scope's text, alternating");
  ok(body.includes('<span class="pkg-ph-tag">Jupiter 4</span>') && body.includes('<span class="pkg-ph-tag">PN-6</span>') && body.includes('href="/ds"'),
    "photo wrap (package): tags print; the datasheet link stays under its key product");
  ok(PACKAGE_WEB_CSS.includes(".pkg-kp { margin-top: 14px; }") && !PACKAGE_WEB_CSS.includes("overflow: hidden; margin-top: 14px") &&
     PACKAGE_WEB_CSS.includes(".pkg-body-ph { display: flow-root; }") && PACKAGE_WEB_CSS.includes(".pkg-ph { float: right; width: 34%; margin: 0 0 8px 14px; position: relative;") &&
     PACKAGE_WEB_CSS.includes("background: rgba(22,24,29,.86)") && /@media print \{[\s\S]*\.pkg-ph-tag \{ font-size: 9px; \}/.test(PACKAGE_WEB_CSS) &&
     /@media \(max-width: 600px\) \{[\s\S]*\.pkg-ph \{ float: none; width: 100%; margin: 0 0 10px; \}/.test(PACKAGE_WEB_CSS),
    "photo wrap (package): the scope body is the float container; 34 % photos, dark tag (9px in print), full width on a phone");
  ok(PACKAGE_LEFT_PHOTO_CSS.includes(".pkg-ph.pkg-ph-left { float: left; margin: 0 14px 8px 0; }") && PACKAGE_LEFT_PHOTO_CSS.includes(".pkg-ph.pkg-ph-left .pkg-ph-tag { right: auto; left: 0; }"),
    "photo wrap (package): a left photo's tag sits bottom-left");
  // Task 2 review: on a phone the photo is full width, so the tag returns to the bottom-right corner (left or right photo alike).
  const phone = PACKAGE_WEB_CSS.slice(PACKAGE_WEB_CSS.indexOf("@media (max-width: 600px)"), PACKAGE_WEB_CSS.indexOf("@page"));
  const phoneLeft = PACKAGE_LEFT_PHOTO_CSS.slice(PACKAGE_LEFT_PHOTO_CSS.indexOf("@media (max-width: 600px)"));
  ok(phone.includes(".pkg-ph img { max-height: 3in; object-position: right top; }") && /\.pkg-ph\.pkg-ph-left \.pkg-ph-tag \{ left: auto; right: 0; \}/.test(phoneLeft) &&
     /\.pkg-ph\.pkg-ph-left img \{ object-position: right top; \}/.test(phoneLeft),
    "photo wrap (package): on a phone the tag is bottom-right and the image pushed right, for a left photo too");
  // The tag's web size is checked on the tag rule itself, not page-wide.
  const tagRule = PACKAGE_WEB_CSS.match(/\.pkg-ph-tag \{[^}]*\}/)?.[0] ?? "";
  ok(tagRule.includes("font-size: 10px") && tagRule.includes("var(--font-mono)") && tagRule.includes("padding: 2px 6px"), "photo wrap (package): the web tag is 10px mono with 2px 6px padding");
  for (const f of ["src/lib/estimate-output/package-loader.ts", "src/lib/estimate-output/package-live-loader.ts"])
    ok(rd(f).includes("loadKeyProductModels(packagePhotoSections(doc.sections), doc.document)") && rd(f).includes("models,"), `photo wrap (package): ${f} reads the models for every scope's key products`);
}

function packageDocPhotoChecks(ok: Ok) {
  const sections = wrapSections();
  const PB = (lineKey: string, sku: string, text: string, photo = { show: true, align: "right", width: 40 }) =>
    ({ type: "productBlock", attrs: { sectionId: "s2", lineKey, sku, photo }, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  const IMG = (lineKey: string, sku: string, align = "left") => ({ type: "productImage", attrs: { sectionId: "s2", lineKey, sku, align, width: 34 } });
  const doc = { type: "doc", version: 1, content: [PB("5", "SKU-5", "Five words."), { type: "paragraph", content: [{ type: "text", text: "After five." }] }, IMG("6", "SKU-6")] } as never;
  const ctx = { sections, t: { grand: 1, tax: 0, credit: 0 } as never, quoteId: "Q-1", photos: PHOTOS, models: { "SKU-5": "Jupiter 4" } };
  const r = resolvePackageDoc(doc, ctx);
  const prod = r.blocks[0] as { t: string; model?: string }, img = r.blocks[2] as { t: string; model?: string };
  ok(prod.t === "product" && prod.model === "Jupiter 4" && img.t === "image" && img.model === "PN-6", "photo wrap (pkg doc): resolved product blocks and images carry their tag text");
  const bare = resolvePackageDoc(doc, { ...ctx, models: undefined, sections: qd293Sections() });
  ok(!("model" in (bare.blocks[0] as object)) && !("model" in (bare.blocks[2] as object)), "photo wrap (pkg doc): no models and no line model → no `model` key (old documents resolve as before)");
  const html = renderToStaticMarkup(createElement(PackageDocView, { doc, ctx }));
  ok(html.includes('<div class="pd-product" data-sku="SKU-5" style="display:block;margin:12px 0"><figure class="pd-ph" style="float:right;width:40%;margin:0 0 8px 14px;position:relative;break-inside:avoid">') &&
     html.indexOf("Five words.") < html.indexOf("After five.") && !html.includes("display:flow-root;margin:12px 0"),
    "photo wrap (pkg doc): a product block with its photo is a plain block, so the following paragraphs keep wrapping");
  ok(html.includes('<span class="pd-ph-tag"') && html.includes(">Jupiter 4</span>") && html.includes('<div class="pd-image" data-sku="SKU-6"><figure class="pd-ph" style="float:left;width:34%') && html.includes(">PN-6</span>"),
    "photo wrap (pkg doc): product photos and product images both carry the tag");
  ok(PACKAGE_DOC_CSS.includes(".pd-doc { display: flow-root; }") && PACKAGE_DOC_CSS.includes(".pd-doc .pd-product { break-inside: avoid; page-break-inside: avoid; }") &&
     PACKAGE_DOC_CSS.includes(".pd-doc .pd-ph { break-inside: avoid; page-break-inside: avoid; }") && PACKAGE_DOC_CSS.includes(".pd-doc .pd-ph-tag { font-size: 10px; }") &&
     PACKAGE_DOC_CSS.includes("@media print { .pd-doc .pd-ph-tag { font-size: 9px; } }") && PACKAGE_DOC_CSS.includes("@media print { .pd-doc .pd-pagebreak { border-top: 0 !important; margin: 0 !important; } }") &&
     /@media \(max-width: 480px\) \{\s*\.pd-doc \.pd-ph \{ float: none !important; display: block !important; width: 100% !important; margin: 0 0 10px 0 !important; \}\s*\.pd-doc \.pd-ph img \{ max-height: 3in !important; object-position: right top !important; \}\s*\.pd-doc \.pd-ph-tag \{ left: auto !important; right: 0 !important; \}\s*\.pd-doc \.pd-ph\.pd-ph-full \{ width: fit-content !important; max-width: 100% !important; margin: 0 auto 10px !important; \}\s*\}/.test(PACKAGE_DOC_CSS),
    "photo wrap (pkg doc): the document is the float container; tags 10px on screen, 9px in print; phones full width with the tag bottom-right (a full photo still shrinks to its picture)");

  // Editor: the same tag rule, from the library row.
  const row = { inCatalog: true, desc: "Five", paragraph: null, paragraphUpdatedAt: null, paragraphUpdatedBy: null, photoDocId: "PD-abcdef", fallbackDocId: null, fallbackLabel: null,
    modelPart: { sku: "SKU-5", manufacturerModelNumber: "Jupiter 4" } };
  const a5 = { sectionId: "s2", lineKey: "5", sku: "SKU-5" };
  ok(editorPhotoTag(a5, sections, row) === "Jupiter 4" && editorPhotoTag(a5, sections, { ...row, photoDocId: null }) === "" && editorPhotoTag({ sectionId: "s2", lineKey: "6", sku: "SKU-6" }, sections, null) === "",
    "photo wrap (editor): an own photo tags from the part; no photo source → no tag");
  const ED = "src/components/package-doc/editor";
  const pbv = rd(`${ED}/product-block-view.tsx`), iv = rd(`${ED}/product-image-view.tsx`);
  ok(pbv.includes('display: "block",') && !pbv.includes('"flow-root"') && pbv.includes("editorPhotoTag(block.attrs, sections, row)") && pbv.includes("photoTagStyle(photo.align, 10)"),
    "photo wrap (editor): a product block is never a float box in the editor either, and its photo shows the tag");
  ok(iv.includes("editorPhotoTag(a, sections, row)") && iv.includes("photoTagStyle("), "photo wrap (editor): a product image shows the tag");
  ok(rd("src/lib/narrative/library.ts").includes("modelPart:"), "photo wrap (editor): library rows carry the part's model fields");
  packageDocFixRound1Checks(ok);
}

/** Task 4 review fix round 1: stale anchors, full-width figures, the editor's placeholder and manufacturer paths. */
function packageDocFixRound1Checks(ok: Ok) {
  // (1) A stale anchor: its line key now holds another part (SKU-9, "WRONG-9"). Its own SKU-5 photo still prints,
  // but never borrows that line's model — print, editor and the server's models map alike.
  const stale = wrapSections().map((s) =>
    s.id === "s2" ? { ...s, keyProducts: [], items: s.items.map((it) => (it.id === 5 ? { ...it, sku: "SKU-9", manufacturerModelNumber: "WRONG-9" } : it)) } : s
  );
  const a5 = { sectionId: "s2", lineKey: "5", sku: "SKU-5" };
  const sdoc = { type: "doc", version: 1, content: [{ type: "productImage", attrs: { ...a5, align: "right", width: 34 } }] } as never;
  const sctx = { sections: stale, t: { grand: 1, tax: 0, credit: 0 } as never, quoteId: "Q-1", photos: PHOTOS };
  const noModels = resolvePackageDoc(sdoc, sctx).blocks[0] as { t: string; model?: string };
  const withModels = resolvePackageDoc(sdoc, { ...sctx, models: { "SKU-5": "Jupiter 4" } }).blocks[0] as { t: string; model?: string };
  ok(noModels.t === "image" && !("model" in noModels) && withModels.model === "Jupiter 4" && photoModelOf(a5, sctx) === "",
    "photo wrap fix 1 (print): a stale anchor's photo never prints the other part's model — only its own sku's (models[sku]) or none");
  const row = { inCatalog: true, desc: "Five", paragraph: null, paragraphUpdatedAt: null, paragraphUpdatedBy: null, photoDocId: "PD-abcdef", fallbackDocId: null, fallbackLabel: null,
    modelPart: { sku: "SKU-5", manufacturerPartNumber: "PN-5" } };
  ok(editorPhotoTag(a5, stale, row) === "PN-5" && editorPhotoTag(a5, stale, { ...row, modelPart: undefined }) === "",
    "photo wrap fix 1 (editor): a stale anchor tags from its own part (partModel), never the line's other part; no part → no tag");
  const parts = new Map([["SKU-5", { sku: "SKU-5", manufacturerPartNumber: "PN-5" }]]);
  const m = keyProductModelsFor({ sections: stale, document: sdoc, skus: ["SKU-5"], parts });
  const live = keyProductModelsFor({ sections: wrapSections().map((s) => (s.id === "s2" ? { ...s, keyProducts: [], items: s.items.map((it) => (it.id === 5 ? { ...it, manufacturerModelNumber: "LINE-5" } : it)) } : s)), document: sdoc, skus: ["SKU-5"], parts });
  ok(m["SKU-5"] === "PN-5" && live["SKU-5"] === "LINE-5",
    "photo wrap fix 1 (keyProductModelsFor): a stale document anchor lends no line (the part's own model); a live one still does");

  // (2) + (3) A full photo: the figure shrinks to the picture (≤ width %, centred), clears earlier floats, tag bottom-right on it.
  const fdoc = { type: "doc", version: 1, content: [
    { type: "productBlock", attrs: { ...a5, photo: { show: true, align: "full", width: 60 } }, content: [{ type: "paragraph", content: [{ type: "text", text: "Full words." }] }] },
    { type: "productImage", attrs: { sectionId: "s2", lineKey: "6", sku: "SKU-6", align: "full", width: 50 } },
  ] } as never;
  const fhtml = renderToStaticMarkup(createElement(PackageDocView, { doc: fdoc, ctx: { ...sctx, sections: wrapSections(), models: { "SKU-5": "Jupiter 4" } } }));
  const FULL_IMG = 'style="display:block;width:auto;max-width:100%;max-height:4in;object-fit:contain"/>';
  ok(fhtml.includes('<figure class="pd-ph pd-ph-full" style="display:block;width:fit-content;max-width:60%;margin:0 auto 10px;position:relative;break-inside:avoid;clear:both"><img src="data:image/png;base64,QUFB" alt="Five" ' + FULL_IMG) &&
     fhtml.includes('<div class="pd-image" data-sku="SKU-6"><figure class="pd-ph pd-ph-full" style="display:block;width:fit-content;max-width:50%;margin:0 auto 10px;position:relative;break-inside:avoid;clear:both"><img src="data:image/png;base64,QkJC" alt="Six" ' + FULL_IMG),
    "photo wrap fix 2+3 (print): a full photo (product block and product image) is a shrink-wrapped, centred figure ≤ its width % that clears earlier floats");
  ok(/<span class="pd-ph-tag" style="position:absolute;bottom:0;right:0;[^"]*">Jupiter 4<\/span>/.test(fhtml) && !/<span class="pd-ph-tag" style="[^"]*left:0/.test(fhtml),
    "photo wrap fix 3 (print): a full photo's tag sits bottom-right, on the picture's own corner");
  const ED = "src/components/package-doc/editor";
  const pbv = rd(`${ED}/product-block-view.tsx`), iv = rd(`${ED}/product-image-view.tsx`);
  const fig = docPhotoFigureStyle("full", 60);
  ok(pbv.includes("style={docPhotoFigureStyle(photo.align, photo.width)}") && pbv.includes("style={docPhotoImgStyle(photo.align)}") && rd("src/components/package-doc/package-doc-view.tsx").includes("style={docPhotoFigureStyle(ph.align, ph.width)}") &&
     fig.clear === "both" && fig.width === "fit-content" && fig.maxWidth === "60%" && docPhotoImgStyle("full").width === "auto" && docPhotoImgStyle("right").width === "100%",
    "photo wrap fix 2+3 (editor): a product block's photo uses the print's own figure/img styles (a full one shrinks and clears)");
  ok(iv.includes('if (img.align === "full") return { display: "block", width: "fit-content", maxWidth: `${img.width}%`, margin: "4px auto 10px", clear: "both" };') &&
     iv.includes("style={docPhotoImgStyle(shownAlign)}") && iv.includes("{tag ? <span style={photoTagStyle(shownAlign, 10)}>{tag}</span> : null}") && !iv.includes("preview && tag"),
    "photo wrap fix 3+5 (editor): a full product image shrinks to its picture like print; the img uses the shared style; no redundant guard");

  // (4) The editor tag's placeholder and manufacturer-image paths.
  const alw = qd293Sections().map((s) => (s.id === "s1" ? { ...s, items: s.items.map((it) => (it.id === 2 ? { ...it, manufacturerPartNumber: "ALW-2" } : it)) } : s));
  const a2 = { sectionId: "s1", lineKey: "2", sku: "SKU-2" };
  const mfrRow = { ...row, photoDocId: null, fallbackDocId: "PD-mfr000", fallbackLabel: "Acme", modelPart: { sku: "SKU-2", manufacturerModelNumber: "PART-M" } };
  ok(editorPhotoTag(a2, alw, mfrRow) === "ALW-2" && editorPhotoTag(a2, qd293Sections(), mfrRow) === "",
    "photo wrap fix 4 (editor): a kind placeholder tags only from the line's own model — never row.modelPart (none → no tag)");
  ok(editorPhotoTag(a5, wrapSections(), { ...mfrRow, modelPart: { sku: "SKU-5", manufacturerModelNumber: "Jupiter 4" } }) === "Jupiter 4",
    "photo wrap fix 4 (editor): a manufacturer image tags from the part, like an own photo");
}

function titlePageChecks(ok: Ok) {
  const props = qd293Props({ pdfOptions: { pdfItemizedAppendix: true } });
  const print = renderQuoteDocument293(props);
  const tp = print.indexOf('<div class="est-titlepage">');
  const at = (s: string) => print.indexOf(s);
  ok(tp > 0 && at(">QUOTE</div>") > tp && at(">Prepared for</div>") > tp && at("Cover note.") > tp && at("Cover note.") < at('class="est-secband"'),
    "title page: letterhead, title block, meta and the cover note open the PDF");
  ok(!print.includes("Total investment"), "title page: the PDF drops the investment band (the totals block shows the Total)");
  ok(at('class="est-secband"') < at('class="est-totals"') && at('class="est-totals"') < at("Questions? Reach out") && at("Questions? Reach out") < at("Assume access.") && at("Assume access.") < at('class="est-appendix"'),
    "title page: narratives → pricing (totals, terms, acceptance, footer, assumptions) → the BOM appendix last");
  const web = renderQuoteDocument293({ ...props, layout: "web" });
  ok(!web.includes("est-titlepage") && web.includes("Total investment") && web.indexOf('class="est-appendix"') < web.indexOf("Questions? Reach out"),
    "title page: the online estimate keeps today's order (investment band, appendix inside the totals)");
  const { QUOTE_PRINT_CSS } = quoteDocumentModule293();
  ok(QUOTE_PRINT_CSS.includes(".est-doc .est-titlepage { break-after: page; page-break-after: always; }") && QUOTE_PRINT_CSS.includes(".est-doc .est-appendix { break-before: page; page-break-before: always; }"),
    "title page: the title page ends its page; the BOM starts a new one");
}

async function datasheetLinkChecks(ok: Ok) {
  const S = "pw-secret", Q = "Q-2041", D = "PD-abcdef12";
  const sig = datasheetLinkSig(S, Q, D);
  ok(DATASHEET_SIG_RE.test(sig) && sig.length === 22 && datasheetLinkSig(S, Q, D) === sig, "ds link: a stable 22-char base64url signature");
  ok(verifyDatasheetLinkSig(S, Q, D, sig) && !verifyDatasheetLinkSig(S, "Q-2042", D, sig) && !verifyDatasheetLinkSig(S, Q, "PD-abcdef13", sig) && !verifyDatasheetLinkSig("other", Q, D, sig) &&
     !verifyDatasheetLinkSig("", Q, D, sig) && !verifyDatasheetLinkSig(S, Q, D, sig.slice(0, 21) + (sig[21] === "A" ? "B" : "A")) && !verifyDatasheetLinkSig(S, Q, D, sig + "x"),
    "ds link: bound to exactly this quote + datasheet + secret; tampered, short or long signatures fail");
  ok(datasheetLinkPath(S, Q, D) === `/d/ds/Q-2041/PD-abcdef12/${sig}` && datasheetLinkPath(S, "Q 1/2", D).startsWith("/d/ds/Q%201%2F2/"), "ds link: the path encodes the quote id");
  ok(inlineDisposition("Spot sheet.pdf").startsWith('inline; filename="Spot sheet.pdf"'), "ds link: inline disposition keeps the attachment name rules");

  const doc = { id: D, kind: "datasheet", title: "Spot", fileName: "spot.pdf", contentType: "application/pdf", size: 9, blobKey: "part-docs/spot.pdf" };
  const q = { id: Q, spec: {}, packageSelection: null };
  const base = { secret: S, allow: () => true, getQuote: async (id: string) => (id === Q ? (q as never) : null), docFor: async (_q: unknown, id: string) => (id === D ? (doc as never) : null),
    stream: async (): Promise<ReadableStream | null> => new Blob(["%PDF-1.4 spot"]).stream() };
  const req = new Request("http://app.test/d/ds/x");
  const good = await serveEstimateDatasheet(req, { quoteId: Q, docId: D, sig }, base);
  ok(good.status === 200 && good.headers.get("content-type") === "application/pdf" && (good.headers.get("content-disposition") || "").startsWith("inline;") &&
     good.headers.get("x-content-type-options") === "nosniff" && good.headers.get("cache-control") === "private, max-age=300" && (await good.text()) === "%PDF-1.4 spot",
    "ds link: a good link streams the stored datasheet inline, nosniff, private cache");
  const statusOf = async (p: { quoteId: string; docId: string; sig: string }, d: Partial<typeof base> = {}) => (await serveEstimateDatasheet(req, p, { ...base, ...d })).status;
  ok((await statusOf({ quoteId: Q, docId: D, sig: "A".repeat(22) })) === 404 && (await statusOf({ quoteId: Q, docId: "nope", sig })) === 404 &&
     (await statusOf({ quoteId: Q, docId: D, sig }, { getQuote: async () => null })) === 404 && (await statusOf({ quoteId: Q, docId: D, sig }, { docFor: async () => null })) === 404 &&
     (await statusOf({ quoteId: Q, docId: D, sig }, { getQuote: async () => { throw new Error("db down"); } })) === 404 && (await statusOf({ quoteId: Q, docId: D, sig }, { stream: async () => null })) === 404,
    "ds link: bad signature, bad id, deleted quote, a datasheet no longer listed, a DB error, a missing file → the same 404");
  ok((await statusOf({ quoteId: Q, docId: D, sig }, { stream: async () => { throw new Error("blob"); } })) === 502 && (await statusOf({ quoteId: Q, docId: D, sig }, { allow: () => false })) === 429,
    "ds link: a storage error is 502 (no vendor text); over the per-IP rate → 429");
  const img = await serveEstimateDatasheet(req, { quoteId: Q, docId: D, sig }, { ...base, docFor: async () => ({ ...doc, contentType: "image/png", fileName: "spot.png" }) as never });
  ok((img.headers.get("content-disposition") || "").startsWith("attachment;") && (img.headers.get("content-security-policy") || "").includes("sandbox"), "ds link: anything but a PDF downloads, sandboxed");

  const mw = rd("src/middleware.ts"), route = rd("src/app/d/ds/[quoteId]/[docId]/[sig]/route.ts"), pds = rd("src/lib/estimate-output/package-docs-server.ts");
  ok(mw.includes("|share/|d/ds/|"), "ds link: the route is outside the team login (middleware matcher)");
  const matcherSrc = /matcher:\s*\[\s*"([^"]+)"/.exec(mw)?.[1]?.replace(/\\\\/g, "\\") ?? "";
  const gated = (path: string) => new RegExp("^" + matcherSrc + "$").test(path);
  ok(!!matcherSrc && !gated("/share/quote/x") && !gated("/d/ds/Q-2041/PD-abcdef12/" + sig) && gated("/d/ds") && gated("/d/dsx/a") && gated("/d/other") && gated("/dashboard") && gated("/quotes"),
    "ds link: the exemption covers exactly the /d/ds/ prefix — nothing broader");
  ok(route.includes("serveEstimateDatasheet(req, await ctx.params)") && route.includes('export const dynamic = "force-dynamic"'), "ds link: the route only delegates");
  ok(pds.includes("export async function packageDocForSpec(") && pds.includes("return packageDocForSpec(rev.spec, rev.docFields?.packageSelection ?? null, docId);"),
    "ds link: one 'is this document on this package' rule for the share route and the permanent link");
}

function datasheetLinksPageChecks(ok: Ok) {
  const rows = datasheetLinkRows({
    bom: [{ sku: "ETC:CS-SPOT" }, { sku: "ETC:LENS" }, { sku: "Symetrix:Jupiter 4" }, { sku: "NODOC" }],
    parts: [
      { sku: "ETC:CS-SPOT", mfr: "ETC", desc: "ColorSource Spot", manufacturerModelNumber: "CS Spot" },
      { sku: "ETC:LENS", mfr: "ETC", desc: "Lens tube" },
      { sku: "Symetrix:Jupiter 4", mfr: "Symetrix", desc: "DSP", manufacturerModelNumber: "Jupiter 4", manufacturerPartNumber: "80-0043" },
      { sku: "NODOC", mfr: "X", desc: "No sheet" },
    ],
    documents: [
      { documentId: "PD-spot0001", kind: "datasheet", skus: ["ETC:CS-SPOT", "ETC:LENS"] },
      { documentId: "PD-urlonly1", kind: "datasheet", skus: ["Symetrix:Jupiter 4"] },
      { documentId: "PD-spec0001", kind: "specsheet", skus: ["ETC:CS-SPOT"] },
    ],
    hosted: (id) => id !== "PD-urlonly1",
    href: (id) => "https://app.test/d/ds/Q-1/" + id + "/sig",
  });
  ok(JSON.stringify(rows.map((r) => [r.manufacturer, r.model, r.description, r.href.slice(-15)])) ===
     JSON.stringify([["ETC", "CS Spot", "ColorSource Spot", "PD-spot0001/sig"], ["ETC", "LENS", "Lens tube", "PD-spot0001/sig"]]),
    "ds page: one row per (part, hosted datasheet) in BOM order — a fixture sheet covering an accessory lists both; spec sheets and URL-only sheets don't print");
  const html = renderToStaticMarkup(createElement(DatasheetLinksPage, { rows, quoteNumber: "EST-1042", projectName: "North HS" }));
  ok(html.includes('class="est-dslinks"') && html.includes(">Manufacturer</th>") && html.includes(">Model</th>") && html.includes(">Description</th>") &&
     html.includes('href="https://app.test/d/ds/Q-1/PD-spot0001/sig"') && html.includes("Datasheet ↗") && html.includes("EST-1042"),
    "ds page: Manufacturer · Model · Description · Datasheet ↗ (absolute links)");
  ok(renderToStaticMarkup(createElement(DatasheetLinksPage, { rows: [], quoteNumber: "EST-1", projectName: "" })) === "", "ds page: no rows → no page");
  ok(DATASHEET_LINKS_CSS.includes(".est-dslinks { break-before: page; page-break-before: always;") && DATASHEET_LINKS_CSS.includes(".est-dslinks tr { break-inside: avoid; page-break-inside: avoid; }"),
    "ds page: starts its own page; a row never splits");
  const pr = rd("src/app/print/quote/[id]/page.tsx");
  ok(pr.includes('rawPart !== "main" && rawPart !== "tail"') && /if \(rawPart !== undefined && \(bidder \|\|/.test(pr), "ds page: ?part= is main | tail only, and never with a bidder");
  ok(pr.includes('!bidder && part !== "main" ? loadDatasheetLinkRows(q, origin) : []') && pr.includes("<DatasheetLinksPage") && pr.includes('part !== "tail" &&'),
    "ds page: the customer PDF ends with the links (main hides them; tail prints only them); the bidder PDF never has them");
}

export async function mkPdf(sizes: Array<[number, number]>, uri?: string): Promise<Buffer> {
  const d = await PDFDocument.create();
  for (const [w, h] of sizes) {
    const pg = d.addPage([w, h]);
    if (uri) {
      const link = d.context.register(d.context.obj({ Type: "Annot", Subtype: "Link", Rect: [72, 700, 200, 720], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(uri) } }));
      pg.node.set(PDFName.of("Annots"), d.context.obj([link]));
    }
  }
  return Buffer.from(await d.save());
}
export function uriOf(page: import("pdf-lib").PDFPage): string | null {
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  const a0 = annots?.lookupMaybe(0, PDFDict);
  const act = a0?.lookupMaybe(PDFName.of("A"), PDFDict);
  const u = act?.lookupMaybe(PDFName.of("URI"), PDFString);
  return u ? u.decodeText() : null;
}
/** A one-page PDF carrying `px`² of incompressible noise (~3·px² bytes) — for the size guard. */
function noiseRaw(w: number, h: number, seed: number): Buffer {
  const raw = Buffer.alloc(w * h * 3);
  let x = seed * 2654435761 >>> 0;
  for (let i = 0; i < raw.length; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; raw[i] = x & 255; }
  return raw;
}
async function noisePdf(px: number, seed: number): Promise<Buffer> {
  const png = await sharp(noiseRaw(px, px, seed), { raw: { width: px, height: px, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  const d = await PDFDocument.create();
  const img = await d.embedPng(png);
  d.addPage([612, 792]).drawImage(img, { x: 36, y: 36, width: 540, height: 540 });
  return Buffer.from(await d.save());
}
const pf = (id: string, name: string, size: number, contentType = "application/pdf") =>
  ({ id, kind: "plan", name, blobPath: `estimate-files/Q-1/UP-0123456789abcdef/${name}`, contentType, size, source: "upload", addedAt: 1, addedBy: "Pat" }) as never;

/* ---- Spec §4 staleness (Task 9): drawing / datasheet-choice writes re-render the PDF without becoming content ---- */
function rerenderChecks(ok: Ok) {
  const files = [pf("PF-000000000001", "a.pdf", 10), { ...(pf("PF-000000000002", "b.pdf", 10) as Record<string, unknown>), source: "grid", blobPath: "estimate-files/Q-1/grid/drawing-set.pdf" }];
  const k0 = pdfAppendixKey({ packageFiles: files, packageSelection: null });
  ok(k0 === pdfAppendixKey({ packageFiles: files, packageSelection: { estimatePdf: false, coverPdf: false } }), "rerender: the email attachment defaults never re-render the PDF");
  ok(k0 !== pdfAppendixKey({ packageFiles: files, packageSelection: { drawings: false } }) && k0 !== pdfAppendixKey({ packageFiles: files, packageSelection: { excludedDatasheets: ["ETC:SPOT"] } }) &&
     k0 !== pdfAppendixKey({ packageFiles: files.slice(1), packageSelection: null }), "rerender: drawings on/off, a left-out datasheet and an added/removed drawing each change what the PDF prints");
  ok(pdfAppendixKey(null) === "" && pdfAppendixKey({}) === pdfAppendixKey({ packageFiles: [], packageSelection: undefined }), "rerender: no quote / nothing → a stable key");
  const pa = rd("src/app/(app)/estimator/package-actions.ts"), act = rd("src/app/(app)/estimator/actions.ts"), hook = rd("src/app/(app)/estimator/use-estimator-state.ts"), panel = rd("src/app/(app)/estimator/package-staff-panel.tsx");
  ok((pa.match(/rerenderIfAppendixMoved\(/g) || []).length === 4 && pa.includes("scheduleQuotePdf(") && pa.includes("pdfAppendixKey("), "rerender: drawing upload, remove and Generate from Grid re-render the PDF when the shown drawings moved");
  ok(act.includes("pdfAppendixKey(") && act.includes("selectionPdf"), "rerender: a Client package selection write re-renders the PDF when its drawings / datasheets changed");
  ok(/const r = await updateQuoteMetaAction\(id, \{ packageSelection: latest \}\);[\s\S]{0,200}if \(r\.pdf\) setPdf\(r\.pdf\);/.test(hook) && panel.includes("onPdf?.(r.pdf)"),
    "rerender: the Estimator's PDF view follows (Updating PDF…)");
  ok(!rd("src/app/(app)/estimator/pdf-doc-key.ts").includes("packageFiles"), "rerender: the client's Unsaved-changes key is untouched (these writes save themselves)");
}

async function appendixPureChecks(ok: Ok) {
  const MB = 1024 * 1024;
  // Amendment A1 (Jeff, Oct 16): the finished PDF stays ≤ 14 MB so Send can still attach it (15 MB email limit).
  ok(ESTIMATE_PDF_TARGET_MAX_BYTES === 14 * MB && ESTIMATE_PDF_TARGET_MAX_BYTES < ESTIMATE_EMAIL_ATTACH_MAX,
    "drawings: the estimate PDF's ceiling is 14 MB — headroom under the 15 MB email attachment limit");
  ok(drawingsBudget(3 * MB, 1 * MB) === 10 * MB && drawingsBudget(20 * MB, 0) === 0 && drawingsBudget(NaN, 0) === 0 && drawingsBudget(2 * MB, -5) === 12 * MB,
    "drawings: the drawings budget is 14 MB less the estimate and links pages (never negative)");
  const plan = planDrawings([pf("PF-000000000001", "a.pdf", 30 * MB), pf("PF-000000000002", "b.pdf", 6 * MB), pf("PF-000000000003", "c.pdf", 5 * MB), pf("PF-000000000004", "d.pdf", 4 * MB), pf("PF-000000000005", "e.pdf", 1 * MB), pf("PF-000000000006", "f.pdf", 0)],
    { perFile: 25 * MB, total: 12 * MB });
  ok(JSON.stringify(plan.map((e) => [e.file.name, e.skip])) === JSON.stringify([["a.pdf", "too-big"], ["b.pdf", null], ["c.pdf", null], ["d.pdf", "over-total"], ["e.pdf", null], ["f.pdf", "unreadable"]]),
    "drawings: list order, 25 MB per file, then whatever fits the budget — a drawing that doesn't fit is skipped (the next may still fit), never the PDF; a sizeless file is unreadable, never 'over 25 MB'");
  ok(planDrawings([pf("PF-000000000001", "a.pdf", 13 * MB), pf("PF-000000000002", "b.pdf", 2 * MB)]).map((e) => e.skip).join() === ",over-total",
    "drawings: with no budget given, the 14 MB ceiling is the most drawings can take");
  const land = imagePagePlacement(2000, 1000)!, port = imagePagePlacement(100, 300)!;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  ok(land.pageW === 792 && land.pageH === 612 && near(land.w, 720) && near(land.h, 360) && near(land.x, 36) && near(land.y, 126), "drawings: a wide image gets a landscape letter page, fitted inside 0.5in margins, centred");
  ok(port.pageW === 612 && port.pageH === 792 && Math.abs(port.h - 720) < 1e-9 && Math.abs(port.x - (612 - 240) / 2) < 1e-9 && imagePagePlacement(0, 10) === null && imagePagePlacement(NaN, 1) === null,
    "drawings: a tall image gets a portrait page; a sizeless image is refused");
  const many = pdfNotesOf(Array.from({ length: 9 }, (_, i) => "note " + i).concat(["note 0", " "]));
  ok(many.length === PDF_NOTES_MAX && many[PDF_NOTES_MAX - 1] === APPENDIX_COPY.more(4) && drawingSkipNote({ name: "Plan A.pdf", reason: "encrypted" }).includes("Plan A.pdf"),
    "drawings: PDF notes are de-duplicated and capped with '…and N more'");
  ok(drawingSkipNote({ name: "Set.pdf", reason: "over-total" }) === "Drawing “Set.pdf” was left out to keep the PDF under 15 MB for email; it’s on the client package page." &&
     drawingSkipNote({ name: "Big.pdf", reason: "too-big" }) === "Drawing “Big.pdf” was left out of the PDF: it is over 25 MB.",
    "drawings: an over-budget drawing's note says why (email size) and where it still is (the client package page)");
  const srcs = ["src/lib/quote-pdf/appendix-plan.ts", "src/lib/quote-pdf/appendix-merge-server.ts", "src/lib/quote-pdf/generate.ts"].map(rd).join("\n");
  const oldCap = 8 * 10; // the plan's original drawings total, replaced by A1 (spelled out here so the literal appears nowhere)
  ok(!srcs.includes(`${oldCap} MB`) && !srcs.includes(`${oldCap} * 1024`) && !srcs.includes("DRAWINGS_TOTAL_MAX_BYTES"), "drawings: the plan's old drawings total cap is gone everywhere (A1)");
  ok(appendixFits(85_000) && !appendixFits(85_001) && !appendixFits(-1) && !appendixFits(NaN), "drawings: the appendix starts only while 15 s + the upload allowance fit in the 120 s budget");

  // pdf-lib merge: main, a 2-page 11×17 PDF, a PNG, a WebP, junk; then the links page with its URI annotation.
  const main = await mkPdf([[612, 792], [612, 792]]);
  const tabloid = await mkPdf([[792, 1224], [792, 1224]]);
  const png = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#ccc" } }).png().toBuffer();
  const webp = await sharp({ create: { width: 100, height: 300, channels: 3, background: "#999" } }).webp().toBuffer();
  const jpg = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#777" } }).jpeg().toBuffer();
  const URI = "https://app.test/d/ds/Q-1/PD-spot0001/AAAAAAAAAAAAAAAAAAAAAA";
  const tail = await mkPdf([[612, 792]], URI);
  const prepped = await prepareDrawings([
    { name: "set.pdf", contentType: "application/pdf", bytes: tabloid },
    { name: "plan.png", contentType: "image/png", bytes: png },
    { name: "riser.webp", contentType: "image/webp", bytes: webp },
    { name: "photo.jpg", contentType: "image/jpeg", bytes: jpg },
    { name: "junk.pdf", contentType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) },
    { name: "huge.pdf", contentType: "application/pdf", bytes: null, skip: "too-big" },
  ]);
  ok(prepped[0].bytes === tabloid && JSON.stringify(prepped.slice(1, 4).map((d) => d.contentType)) === JSON.stringify(["image/jpeg", "image/jpeg", "image/jpeg"]) && prepped[5].skip === "too-big",
    "drawings: images are converted once before the merge (WebP takes the same path; no alpha → JPEG); PDFs and skipped drawings pass through");
  const m = await mergeEstimateAppendices({ main, tail, drawings: prepped });
  const out = await PDFDocument.load(m.bytes);
  const sizes = out.getPages().map((p) => { const s = p.getSize(); return `${Math.round(s.width)}x${Math.round(s.height)}`; });
  ok(m.merged && m.tailAdded && JSON.stringify(sizes) === JSON.stringify(["612x792", "612x792", "792x1224", "792x1224", "792x612", "612x792", "792x612", "612x792"]),
    "drawings: estimate pages, then each drawing at its own size (11×17 stays 11×17; images on a letter page of their orientation), then the links page");
  ok(uriOf(out.getPage(7)) === URI, "drawings: the links page's URI annotation survives the merge");
  ok(JSON.stringify(m.skipped) === JSON.stringify([{ name: "junk.pdf", reason: "unreadable" }, { name: "huge.pdf", reason: "too-big" }]), "drawings: an unreadable or over-cap drawing is skipped and reported");
  const enc = await PDFDocument.load(tabloid);
  (enc.context.trailerInfo as { Encrypt?: unknown }).Encrypt = enc.context.obj({ Filter: "Standard" });
  const encrypted = await mergeEstimateAppendices({ main, tail: null, drawings: [{ name: "locked.pdf", contentType: "application/pdf", bytes: await enc.save() }] });
  ok(encrypted.merged && (await PDFDocument.load(encrypted.bytes)).getPageCount() === 2 && encrypted.skipped[0]?.reason === "encrypted", "drawings: a password-protected PDF is skipped as encrypted (the datasheet book's rule)");
  const late = await mergeEstimateAppendices({ main, tail: null, drawings: [{ name: "set.pdf", contentType: "application/pdf", bytes: tabloid }], deadline: 10, now: () => 11 });
  ok((await PDFDocument.load(late.bytes)).getPageCount() === 2 && late.skipped[0]?.reason === "late", "drawings: past the deadline a drawing is skipped as late");
  const broken = await mergeEstimateAppendices({ main: new Uint8Array([9, 9]), tail, drawings: [{ name: "set.pdf", contentType: "application/pdf", bytes: tabloid }] });
  ok(!broken.merged && broken.fallback === "unmergeable" && Buffer.compare(broken.bytes, Buffer.from([9, 9])) === 0 && broken.skipped.length === 0,
    "drawings: an estimate pdf-lib can't read keeps Chrome's bytes untouched and blames no drawing (one appendix-level outcome)");
  ok(m.fallback === null && late.fallback === null && appendixLeftOutNote("unmergeable", true) === APPENDIX_COPY.notMerged && appendixLeftOutNote("unmergeable", false) === APPENDIX_COPY.notMergedDrawings &&
     appendixLeftOutNote("late", true) === APPENDIX_COPY.late && appendixLeftOutNote("late", false) === APPENDIX_COPY.lateDrawings &&
     !APPENDIX_COPY.lateDrawings.includes("link") && !APPENDIX_COPY.notMergedDrawings.includes("link") && APPENDIX_COPY.notMerged.includes("datasheet links"),
    "drawings: the appendix-level notes name the datasheet links only when the PDF would have had them");

  // Images: one sharp pass — EXIF orientation applied, downscaled to the fitted page at 200 dpi, JPEG unless alpha.
  const bigPng = await sharp(noiseRaw(3000, 2000, 7), { raw: { width: 3000, height: 2000, channels: 3 } }).png().toBuffer();
  const small = await prepareDrawingImage(bigPng);
  const sm = await sharp(small.bytes).metadata();
  ok(DRAWING_IMAGE_DPI === 200 && small.contentType === "image/jpeg" && sm.format === "jpeg" && (sm.width ?? 0) >= 1995 && (sm.width ?? 0) <= 2000 && (sm.height ?? 0) <= 1334 && small.bytes.length < bigPng.length / 3,
    "drawings: a big PNG becomes a JPEG at its fitted page size (10in × 200 dpi = 2,000 px) — a fraction of the bytes");
  const alpha = await prepareDrawingImage(await sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer());
  const tiny = await prepareDrawingImage(png);
  ok(alpha.contentType === "image/png" && (await sharp(alpha.bytes).metadata()).hasAlpha === true && (await sharp(tiny.bytes).metadata()).width === 400,
    "drawings: an image with transparency stays PNG; a small image is never enlarged");
  const sideways = await sharp({ create: { width: 300, height: 100, channels: 3, background: "#555" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const upright = await prepareDrawingImage(sideways);
  const um = await sharp(upright.bytes).metadata();
  const rot = await mergeEstimateAppendices({ main, tail: null, drawings: await prepareDrawings([{ name: "phone.jpg", contentType: "image/jpeg", bytes: sideways }]) });
  const rotPage = (await PDFDocument.load(rot.bytes)).getPage(2).getSize();
  ok((await sharp(sideways).metadata()).orientation === 6 && um.width === 100 && um.height === 300 && (um.orientation ?? 1) === 1 && rotPage.width === 612 && rotPage.height === 792,
    "drawings: an EXIF-rotated photo prints upright — the orientation is applied, so it lands on a portrait page");
  const badImg = await prepareDrawings([{ name: "bad.png", contentType: "image/png", bytes: new Uint8Array([1, 2, 3]) }, { name: "later.png", contentType: "image/png", bytes: png }], { deadline: 5, now: (() => { let c = 0; return () => (c++ ? 9 : 0); })() });
  ok(badImg[0].skip === "unreadable" && badImg[1].skip === "late", "drawings: an image sharp can't read is unreadable; past the deadline the rest are late");

  // A1 final guard: a merged file still over the ceiling drops drawings from the END and re-merges (≤ 3 tries), then main + links only.
  const noise = await Promise.all([1, 2, 3, 4].map((n) => noisePdf(160, n)));
  const one = noise[0].length;
  const base = await mergeEstimateAppendices({ main, tail, drawings: [] });
  const cap = base.bytes.length + Math.round(one * 2.5);
  const guard = await mergeEstimateAppendices({ main, tail, maxBytes: cap, drawings: noise.map((b, n) => ({ name: `n${n + 1}.pdf`, contentType: "application/pdf", bytes: b })) });
  const gOut = await PDFDocument.load(guard.bytes);
  ok(guard.merged && guard.tailAdded && guard.bytes.length <= cap && gOut.getPageCount() === 2 + 2 + 1 && uriOf(gOut.getPage(4)) === URI &&
     JSON.stringify(guard.skipped) === JSON.stringify([{ name: "n3.pdf", reason: "over-total" }, { name: "n4.pdf", reason: "over-total" }]),
    "drawings: a merged PDF over the ceiling drops drawings from the end (as over-total) until it fits, keeping the first ones and the links page");
  const floor = await mergeEstimateAppendices({ main, tail, maxBytes: 1, drawings: noise.map((b, n) => ({ name: `n${n + 1}.pdf`, contentType: "application/pdf", bytes: b })) });
  const fOut = await PDFDocument.load(floor.bytes);
  ok(floor.merged && floor.tailAdded && fOut.getPageCount() === 3 && uriOf(fOut.getPage(2)) === URI && floor.skipped.length === 4 && floor.skipped.every((s) => s.reason === "over-total"),
    "drawings: when nothing fits, the PDF is the estimate + links only — every drawing left out with a note, never a failure");
  // The guard never starts a retry past the deadline: estimate alone + one out-of-time outcome (4 now() reads = the first merge's 4 drawings).
  let reads = 0;
  const lateGuard = await mergeEstimateAppendices({ main, tail, maxBytes: cap, deadline: 50, now: () => (reads++ < 4 ? 0 : 100), drawings: noise.map((b, n) => ({ name: `n${n + 1}.pdf`, contentType: "application/pdf", bytes: b })) });
  ok(reads === 5 && !lateGuard.merged && lateGuard.fallback === "late" && Buffer.compare(lateGuard.bytes, main) === 0 && lateGuard.skipped.length === 0,
    "drawings: a deadline that passes during the size guard stops it at once — the estimate alone, with one out-of-time note");
  ok(STATE_NOTES_MAX === PDF_NOTES_MAX && rd("src/lib/quote-pdf/state.ts").includes("notes: outcome.notes.slice(0, PDF_NOTES_MAX)"), "drawings: one notes cap, shared by the state and the notes builder");
  ok(rd("src/lib/quote-pdf/appendix-merge-server.ts").includes("appendPdfPages(out, d.bytes)") && rd("src/lib/part-docs/datasheet-book-server.ts").includes("appendPdfPages(out, d.bytes)"),
    "drawings: one PDF load / copy / page-box rule shared with the datasheet book");

  // The PDF state carries the notes; the banner shows them on a ready file.
  const ready = settlePdf({ status: "pending", at: 1, savedAt: 5 }, 5, { ok: true, blobPath: "p.pdf", notes: ["Drawing “x” was left out."] }, 9)!;
  const plain = settlePdf({ status: "pending", at: 1, savedAt: 5 }, 5, { ok: true, blobPath: "p.pdf" }, 9)!;
  ok(JSON.stringify(ready.notes) === JSON.stringify(["Drawing “x” was left out."]) && !("notes" in plain), "drawings: a ready PDF records its notes (none → no key)");
  const view = pdfView(ready, 10)!;
  ok(JSON.stringify(view.notes) === JSON.stringify(ready.notes) && !("notes" in pdfView(plain, 10)!) && pdfBanner({ quoteId: "Q-1", pdf: view, dirty: false, timedOut: false, retrying: false }).some((n) => n.tone === "warn" && n.text === "Drawing “x” was left out."),
    "drawings: Customer review → Document shows each note as a warning");
  ok(!pdfBanner({ quoteId: "Q-1", pdf: view, dirty: true, timedOut: false, retrying: false }).some((n) => n.text === "Drawing “x” was left out."), "drawings: an unsaved estimate doesn't show the last file's notes");

  // Carry-overs from Task 7: an empty tail is never printed (no blank page); an unresolvable print origin is logged.
  const pr = rd("src/app/print/quote/[id]/page.tsx");
  ok(pr.includes('if (part === "tail" && !links.length) notFound();') && pr.includes('console.warn("[quote-pdf] no print origin — the PDF has no datasheet links", id, where.error)'),
    "drawings: a tail with no link rows is a 404 (never a blank page); a missing print origin says why in the log");
}

/** Runs `fn` with console.warn captured (the expected warnings stay out of the harness output); returns them. */
async function quietWarnings(fn: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { seen.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(" ")); };
  try {
    await fn();
  } finally {
    console.warn = warn;
  }
  return seen;
}

export async function photoWrapPureChecks(ok: Ok) {
  const warned = await quietWarnings(() => photoWrapPureChecksLoud(ok));
  ok(warned.some((w) => w.includes('drawing "junk.pdf" not merged')) && warned.some((w) => w.includes("estimate PDF not mergeable")) && warned.some((w) => w.includes("[ds-link] lookup failed")),
    "photo wrap: the expected warnings were logged (captured, not printed)");
}

async function photoWrapPureChecksLoud(ok: Ok) {
  spreadChecks(ok);
  modelChecks(ok);
  quoteDocPhotoChecks(ok);
  packagePagePhotoChecks(ok);
  packageDocPhotoChecks(ok);
  titlePageChecks(ok);
  await datasheetLinkChecks(ok);
  datasheetLinksPageChecks(ok);
  await appendixPureChecks(ok);
  rerenderChecks(ok);
}

const FIX = "photo-wrap";

/* ---- Spec §4–5: the generator end to end — drawings merged after the estimate, the links page last ---- */
async function appendixDbChecks(ok: Ok) {
  const keys = ["BLOB_READ_WRITE_TOKEN", "VERCEL", "QUOTE_PDF_DIR"] as const;
  const prev = keys.map((k) => [k, process.env[k]] as const);
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.VERCEL;
  const root = mkdtempSync(join(tmpdir(), "quote-pdfs-pw-"));
  process.env.QUOTE_PDF_DIR = root;
  try {
    const qid = fixtureId(FIX, "drawings");
    const seg = quotePathSegment(qid);
    const file = (id: string, name: string, contentType: string, size: number) =>
      ({ id, kind: "plan", name, blobPath: `estimate-files/${seg}/UP-0123456789abcdef/${name}`, contentType, size, source: "upload", addedAt: 1, addedBy: "Pat" });
    const sec = { id: "sysP", name: "PW", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 1, sku: "PW-1", desc: "Fixture", qty: 1, unit: "ea", cost: 10, price: 20 }] };
    const quote = { ...buildQuote(qid, { name: "PW drawings", customer: "PW", value: 20, spec: { sections: [sec], mobs: [] } } as never, "system", null, Date.now()),
      packageFiles: [file("PF-0000000000a1", "set.pdf", "application/pdf", 2000), file("PF-0000000000a2", "plan.png", "image/png", 2000)] };
    await createFixture("quotes", quote as never);
    const tabloid = await mkPdf([[792, 1224]]);
    const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#ddd" } }).png().toBuffer();
    const urls: string[] = [];
    const render = async (url: string) => { urls.push(url); return url.includes("&part=tail") ? mkPdf([[612, 792]], "https://print.test/d/ds/x/PD-spot0001/AAAAAAAAAAAAAAAAAAAAAA") : mkPdf([[612, 792], [612, 792]]); };
    const caps: number[] = [];
    const readDrawing = async (f: { name: string }, _s: AbortSignal, maxBytes: number) => { caps.push(maxBytes); return f.name === "set.pdf" ? tabloid : png; };
    const run = async (extra: Record<string, unknown>) => {
      const s = Date.now();
      await updateQuotePdf(qid, () => ({ status: "pending", at: s, savedAt: s }));
      urls.length = 0;
      caps.length = 0;
      await generateQuotePdf({ quoteId: qid, savedAt: s, origin: "http://print.test", secret: "pw-secret", render, readDrawing, ...extra } as never);
      const q = await getQuote(qid);
      const store = pdfStorage();
      const bytes = q?.pdf?.blobPath && !("unavailable" in store) ? await store.read(q.pdf.blobPath) : null;
      return { q, bytes, doc: bytes ? await PDFDocument.load(bytes).catch(() => null) : null };
    };

    // The quote's own Plans & risers (no datasheets in the test catalog → no links render).
    const a = await run({});
    ok(urls.length === 1 && urls[0].includes("&part=main") && a.q?.pdf?.status === "ready" && a.doc?.getPageCount() === 4 &&
       JSON.stringify(a.doc!.getPages().map((p) => Math.round(p.getSize().height))) === "[792,792,1224,612]" && !a.q?.pdf?.notes,
      "generate: a quote with drawings prints the estimate (part=main), then its 11×17 set and its PNG on a landscape page");
    ok(caps.length === 2 && caps[0] < ESTIMATE_PDF_TARGET_MAX_BYTES && caps[0] > ESTIMATE_PDF_TARGET_MAX_BYTES - 64 * 1024 && caps[1] === caps[0] - tabloid.length,
      "generate: each drawing read stops at what is left of the 14 MB budget (never a flat 25 MB)");

    // With a links page: rendered as the tail, after the drawings; a broken drawing becomes a note.
    const b = await run({ appendix: async () => ({ drawings: [...quote.packageFiles, file("PF-0000000000a3", "bad.pdf", "application/pdf", 10)], hasLinks: true }),
      readDrawing: async (f: { name: string }) => (f.name === "set.pdf" ? tabloid : f.name === "plan.png" ? png : new Uint8Array([1])) });
    ok(urls.length === 2 && urls[1].includes("&part=tail") && b.doc?.getPageCount() === 5 && uriOf(b.doc!.getPage(4)) !== null &&
       (b.q?.pdf?.notes || []).some((n) => n.includes("bad.pdf")),
      "generate: the datasheet links come last (after the drawings) and a drawing that couldn't be read is a note on the PDF");

    // A1: drawings take only what's left of 14 MB after the estimate and links pages (a 14 MB drawing never fits beside them).
    const big = await run({ appendix: async () => ({ drawings: [file("PF-0000000000b1", "big.pdf", "application/pdf", 14 * 1024 * 1024), ...quote.packageFiles], hasLinks: false }),
      readDrawing: async (f: { name: string }) => { if (f.name === "big.pdf") throw new Error("read an over-budget drawing"); return f.name === "set.pdf" ? tabloid : png; } });
    ok(big.q?.pdf?.status === "ready" && big.doc?.getPageCount() === 4 && (big.q?.pdf?.notes || []).length === 1 &&
       (big.q?.pdf?.notes || [])[0] === "Drawing “big.pdf” was left out to keep the PDF under 15 MB for email; it’s on the client package page.",
      "generate: a drawing that would push the PDF past 14 MB is never read — it is left out with a note, the others still print");

    // The links render fails: the drawings still print and the PDF says the links page is missing.
    const failTail = async (url: string) => { urls.push(url); if (url.includes("&part=tail")) throw new Error("The print page answered 404."); return mkPdf([[612, 792], [612, 792]]); };
    const c0 = await run({ render: failTail, appendix: async () => ({ drawings: quote.packageFiles, hasLinks: true }) });
    ok(c0.q?.pdf?.status === "ready" && c0.doc?.getPageCount() === 4 && (c0.q?.pdf?.notes || []).includes(APPENDIX_COPY.linksMissing), "generate: a links render that fails leaves a note, never a blank page or a failed PDF");

    // Out of time: estimate only + a note; never a failure.
    let t = 0;
    const c = await run({ now: () => (t += 50_000) });
    ok(c.q?.pdf?.status === "ready" && c.doc?.getPageCount() === 2 && JSON.stringify(c.q?.pdf?.notes) === JSON.stringify([APPENDIX_COPY.lateDrawings]),
      "generate: no time left → the estimate alone, with a drawings-only note (this quote has no links page)");
    let t2 = 0;
    const cl = await run({ now: () => (t2 += 50_000), appendix: async () => ({ drawings: quote.packageFiles, hasLinks: true }) });
    ok(cl.q?.pdf?.status === "ready" && cl.doc?.getPageCount() === 2 && JSON.stringify(cl.q?.pdf?.notes) === JSON.stringify([APPENDIX_COPY.late]),
      "generate: no time left on a quote with links → the note names the drawings and the datasheet links");

    // pdf-lib can't read Chrome's estimate: the file is kept as is, with ONE note — no drawing is blamed.
    const junkMain = async (url: string) => { urls.push(url); return Buffer.from("%PDF-junk"); };
    const jm = await run({ render: junkMain });
    ok(jm.q?.pdf?.status === "ready" && Buffer.from(jm.bytes ?? []).toString() === "%PDF-junk" && JSON.stringify(jm.q?.pdf?.notes) === JSON.stringify([APPENDIX_COPY.notMergedDrawings]),
      "generate: an estimate pdf-lib can't merge → one 'drawings couldn't be added' note, no per-drawing blame");

    // Notes order: the PDF-level note first, so only per-drawing notes fold into "…and N more".
    const bad = Array.from({ length: 7 }, (_, n) => file(`PF-0000000000c${n}`, `bad${n}.pdf`, "application/pdf", 10));
    const ord = await run({ render: failTail, appendix: async () => ({ drawings: bad, hasLinks: true }), readDrawing: async () => new Uint8Array([1]) });
    const on = ord.q?.pdf?.notes || [];
    ok(on.length === PDF_NOTES_MAX && on[0] === APPENDIX_COPY.linksMissing && on[PDF_NOTES_MAX - 1] === APPENDIX_COPY.more(3),
      "generate: the links-missing note leads; seven unreadable drawings fold into '…and 3 more'");

    // No drawings → exactly today's single render (no part, no pdf-lib).
    const d = await run({ appendix: async () => ({ drawings: [], hasLinks: false }) });
    ok(urls.length === 1 && !urls[0].includes("part=") && d.doc?.getPageCount() === 2 && !d.q?.pdf?.notes, "generate: no drawings → one render, as before");

    // The sources fail to load → the PDF prints as before (never fails).
    const e = await run({ appendix: async () => { throw new Error("db down"); } });
    ok(urls.length === 1 && !urls[0].includes("part=") && e.q?.pdf?.status === "ready" && e.doc?.getPageCount() === 2, "generate: drawings that can't be loaded never fail the PDF");

    // Drawings off in the Client package → no drawings, one render.
    await createFixture("quotes", { ...quote, packageSelection: { drawings: false } } as never);
    const f = await run({});
    ok(urls.length === 1 && !urls[0].includes("part=") && f.doc?.getPageCount() === 2, "generate: Client package → Drawings off → the PDF has no drawings");
  } finally {
    await dropFixtures(FIX);
    for (const [k, v] of prev) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    rmSync(root, { recursive: true, force: true });
  }
}

/* ---- Spec §5: /d/ds/ and the links page agree on the REAL lookup (packageDocForSpec over the live quote) ---- */
async function datasheetRouteDbChecks(ok: Ok) {
  const C = await import("../src/lib/stores/catalog");
  const D = await import("../src/lib/stores/part-documents");
  const Q = await import("../src/lib/stores/quotes");
  try {
    const [LISTED, SPEC, LEFT, URLONLY] = ["listed", "spec", "left", "url"].map((x) => fixtureId(FIX, "ds-" + x));
    for (const sku of [LISTED, SPEC, LEFT, URLONLY]) {
      await C.upsert({ sku, desc: "Part " + sku, mfr: "PW", category: "Other", unit: "ea", list: 10, cost: 5 } as never);
      registerFixture("catalog_parts", sku);
    }
    const mk = async (kind: "datasheet" | "specsheet", fileName: string, blobKey: string | null, sku: string) => {
      const doc = await D.createDocument({ kind, fileName, contentType: "application/pdf", size: 1000, blobKey, sourceUrl: blobKey ? null : "https://mfr.test/" + fileName, source: blobKey ? "upload" : "fetch", by: "Test" });
      if (!doc) throw new Error("photo-wrap ds: fixture document failed");
      registerFixture("part_documents", doc.id);
      await D.attachDocument(doc.id, [sku], "Test");
      registerFixture("part_document_links", D.documentLinkId(sku, doc.id));
      return doc;
    };
    const listed = await mk("datasheet", "pw-listed.pdf", "part-docs/PD-fixture-pw/pw-listed.pdf", LISTED);
    const spec = await mk("specsheet", "pw-spec.pdf", "part-docs/PD-fixture-pw/pw-spec.pdf", SPEC);
    const left = await mk("datasheet", "pw-left.pdf", "part-docs/PD-fixture-pw/pw-left.pdf", LEFT);
    const urlOnly = await mk("datasheet", "pw-url.pdf", null, URLONLY);
    const QID = fixtureId(FIX, "ds-quote");
    const line = (id: number, sku: string) => ({ id, sku, desc: sku, qty: 1, unit: "ea", cost: 1, price: 2 });
    await Q.create({ id: QID, name: "PW ds links", customer: "Spec fixture", owner: "spec", quoteType: "system", source: "estimator",
      spec: { sections: [{ id: "s1", name: "Lighting", kind: "materials", mfr: "", freightPct: 0, items: [line(1, LISTED), line(2, SPEC), line(3, LEFT), line(4, URLONLY)] }], mobs: [] } } as never);
    registerFixture("quotes", QID);
    if (!(await Q.setPackageSelection(QID, { excludedDatasheets: [LEFT] })).ok) throw new Error("photo-wrap ds: selection not set");
    const S = "pw-ds-secret";
    const req = new Request("http://app.test/d/ds/x");
    const served: string[] = [];
    // Only the rate limit, the secret and the Blob read are stubbed — the quote read and the datasheet lookup are the real ones.
    const deps = { secret: S, allow: () => true, stream: async (k: string) => { served.push(k); return new Blob(["%PDF-1.4 " + k]).stream(); } };
    const status = async (docId: string) => (await serveEstimateDatasheet(req, { quoteId: QID, docId, sig: datasheetLinkSig(S, QID, docId) }, deps)).status;
    ok((await status(listed.id)) === 200 && served.join() === "part-docs/PD-fixture-pw/pw-listed.pdf", "ds link (DB): a listed datasheet with a stored file is served");
    ok((await status(spec.id)) === 404 && (await status(left.id)) === 404 && (await status(urlOnly.id)) === 404 && served.length === 1,
      "ds link (DB): a spec sheet, a left-out datasheet and a URL-only datasheet are the same 404 (nothing read)");
    const q = (await Q.get(QID))!;
    const rows = await loadDatasheetLinkRows(q, "https://app.test", S);
    ok(rows.length === 1 && rows[0].href === "https://app.test" + datasheetLinkPath(S, QID, listed.id),
      "ds page (DB): the links page lists exactly the datasheet the route serves");
  } finally {
    await dropFixtures(FIX);
  }
}

export async function photoWrapDbChecks(ok: Ok) {
  await quietWarnings(async () => {
    await appendixDbChecks(ok);
    await datasheetRouteDbChecks(ok);
  });
}

if (process.argv[1]?.endsWith("test-photo-wrap.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  const db = !!process.env.PGLITE_PATH;
  photoWrapPureChecks(okf)
    .then(() => (db ? photoWrapDbChecks(okf) : undefined))
    .then(() => { console.log(`${pass} PASS, ${fail} FAIL${db ? "" : " (pure only — set PGLITE_PATH for the DB half)"}`); process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); process.exit(1); });
}

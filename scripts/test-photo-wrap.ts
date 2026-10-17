/* Estimate photo wrap, model tags, title page, drawings + datasheet links
   (docs/superpowers/specs/2026-10-16-estimate-photo-wrap-title-page-design.md) — harness checks.
   `photoWrapPureChecks` needs no database; `photoWrapDbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-photo-wrap.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

export async function photoWrapPureChecks(ok: Ok) {
  spreadChecks(ok);
  modelChecks(ok);
  quoteDocPhotoChecks(ok);
  packagePagePhotoChecks(ok);
  packageDocPhotoChecks(ok);
  titlePageChecks(ok);
  await datasheetLinkChecks(ok);
}

export async function photoWrapDbChecks(_ok: Ok) {
  // Tasks 8 adds the generator checks here.
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

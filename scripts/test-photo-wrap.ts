/* Estimate photo wrap, model tags, title page, drawings + datasheet links
   (docs/superpowers/specs/2026-10-16-estimate-photo-wrap-title-page-design.md) — harness checks.
   `photoWrapPureChecks` needs no database; `photoWrapDbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-photo-wrap.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { spreadPhotoAnchors, photoFigureStyle, photoImgStyle, photoTagStyle, PHOTO_TAG_BG } from "../src/lib/estimate-output/photo-spread";
import { cleanTag, photoTagText, keyProductModelsFor, PHOTO_TAG_MAX } from "../src/lib/estimate-output/photo-models";
import { lineOwnModel } from "../src/lib/catalog-rename/sku";
import type { SpecSection } from "../src/app/(app)/estimator/types";

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

export async function photoWrapPureChecks(ok: Ok) {
  spreadChecks(ok);
  modelChecks(ok);
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

/* #369 — curved track layout + "Preliminary" cut sheets. Pure checks; run alone with
   `npx tsx scripts/test-curved-track.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import type { SpecItem, SpecSection } from "../src/app/(app)/estimator/types";
import type { TrackSeries } from "../src/lib/track-series";
import { collectCurtainTypes } from "../src/lib/curtain-cut-sheets/collect";
import { CUT_SHEET_STAMP, cutSheetModel, type CutSheetContext } from "../src/lib/curtain-cut-sheets/model";
import { titleBlockData } from "../src/lib/design/grid-drawing-set";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const line = (id: number, extra: Partial<SpecItem> = {}): SpecItem =>
  ({ id, sku: "X", desc: "x", qty: 1, unit: "ea", cost: 0, price: 0, ...extra }) as SpecItem;
const sec = (items: SpecItem[]): SpecSection => ({ id: "s1", name: "Stage", kind: "materials", mfr: "", freightPct: 0, items }) as SpecSection;
/** A curtain line read through curtainInputs (no catalog fabric needed). */
const curtain = (id: number, extra: Partial<SpecItem> = {}): SpecItem =>
  line(id, {
    curtain: true,
    qty: 2,
    desc: "Main Drape",
    curtainInputs: { name: "Main Drape", fabricSku: "", fabricName: "Encore Velour 22 oz", qty: "2", width: "20", height: "18", fullness: "50" },
    ...extra,
  } as Partial<SpecItem>);
const collect = (items: SpecItem[], trackSeries: TrackSeries[] = []) =>
  collectCurtainTypes({ quote: { spec: { sections: [sec(items)], mobs: [] } }, fabrics: [], trackSeries, mounts: {}, partInfo: new Map(), grid: null });
const CTX: Omit<CutSheetContext, "style"> = {
  quote: { id: "Q-1", number: "EST-1042", name: "Main stage", customer: "Lakefront HS", venue: "Auditorium", revisions: [] },
  company: { name: "Peak Systems Group", logoDark: null, offices: [] },
  preparedBy: "Jeff Chesebro",
  index: 1,
  total: 1,
  now: 1,
};

export function stampChecks(ok: Ok) {
  ok(CUT_SHEET_STAMP === "PRELIMINARY — NOT FOR CONSTRUCTION", "#369 stamp: the exact words, em dash");
  const t = collect([curtain(1)]).types[0];
  ok(!!t, "#369 stamp: fixture collects one curtain type");
  const sub = cutSheetModel(t, { ...CTX, style: "submittal" });
  const cli = cutSheetModel(t, { ...CTX, style: "client" });
  ok(sub.titleBlock?.stamp === CUT_SHEET_STAMP, "#369 stamp: the Submittal title block carries the stamp");
  ok(cli.titleBlock === null, "#369 stamp: the Client style still has no title block");
  const drawingSet = titleBlockData({
    company: { name: "Peak" },
    project: { id: "G-1", name: "Gym", customer: "Lakefront HS", siteName: "Gym", intake: null, createdBy: "Jeff" },
    option: { name: "", quoteId: null },
    optionCount: 1,
    revisions: [],
    set: undefined,
    sheet: { number: "L-101", title: "Plan", scale: "NTS" },
    index: 1,
    total: 1,
    now: 1,
  } as Parameters<typeof titleBlockData>[0]);
  ok(!("stamp" in drawingSet), "#369 stamp: the Grid drawing set's title block has no stamp");
  const pages = src("src/components/cutsheets/cut-sheet-pages.tsx");
  ok((pages.match(/<Stamp \/>/g) || []).length >= 2, "#369 stamp: the Submittal and Client sheets both render <Stamp />");
  ok(src("src/components/drawing/title-block.tsx").includes("{data.stamp && <div className=\"pk-tb-stamp\">{data.stamp}</div>}"), "#369 stamp: the title block prints data.stamp only when set");
  const css = src("src/app/globals.css");
  ok(css.includes(".pk-cs-stamp {") && css.includes(".pk-cs-area {") && css.includes(".pk-tb-stamp {"), "#369 stamp: the banner, area and title-block styles exist");
}

export async function curvedTrackChecks(ok: Ok) {
  stampChecks(ok);
}

if (process.argv[1]?.endsWith("test-curved-track.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  curvedTrackChecks(okf).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}

/**
 * #292 — building and editing an Estimator curtain line. Pure and
 * client-safe; kept out of estimator-client.tsx so that file's edits stay
 * small. The desc format is UNCHANGED (parse.ts reads it back); the line now
 * also stores structured `curtainInputs` and, with a track, a shared
 * `curtainTrackKey`.
 */
import type { CurtainRequest } from "@/lib/portal-cart-types";
import { parseEstimatorCurtainDesc } from "@/lib/curtain-cut-sheets/parse";
import { newCurtainTrackKey } from "@/lib/curtain-cut-sheets/track-link";
import { ASSUMED_MOUNT, DEFAULT_BOTTOM_FINISH, DEFAULT_TOP_FINISH, isBottomFinish, isMountTypeId, isTopFinish } from "@/lib/curtain-cut-sheets/vocab";
import { curtainSpecKey } from "@/lib/specs/record-keys";
import type { CurtainCalc } from "./pricing";
import { replaceCurtainLine } from "./track-bom";
import type { CurtainDraft, SpecItem, SpecSection } from "./types";

const FULLNESS: ReadonlyArray<CurtainRequest["fullness"]> = ["0", "50", "75", "100"];
const fullnessOf = (v: string): CurtainRequest["fullness"] => (FULLNESS as readonly string[]).includes(v) ? (v as CurtainRequest["fullness"]) : "0";

/**
 * The modal draft for an existing curtain line: curtainInputs, else the parsed
 * desc, else the name only (W/H blank). `fabrics` (optional) lets a legacy
 * line's printed fabric name resolve back to its SKU instead of falling back
 * to the default fabric.
 */
export function curtainDraftFromLine(
  it: SpecItem,
  fallbackFabric: string,
  fabrics: ReadonlyArray<{ sku: string; name: string }> = []
): CurtainDraft {
  const qty = String(Math.max(1, Math.round(Number(it.qty)) || 1));
  const ci = it.curtainInputs;
  const finishes = {
    topFinish: ci && isTopFinish(ci.topFinish) ? ci.topFinish : DEFAULT_TOP_FINISH,
    bottomFinish: ci && isBottomFinish(ci.bottomFinish) ? ci.bottomFinish : DEFAULT_BOTTOM_FINISH,
    mountType: ci && isMountTypeId(ci.mountType) ? ci.mountType : ASSUMED_MOUNT,
  };
  const base = { hang: "Pipe", bottom: "Chain", qty, ...finishes };
  if (ci) return { ...base, name: ci.name || "", fabric: ci.fabricSku || fallbackFabric, width: String(ci.width ?? ""), height: String(ci.height ?? ""), fullness: fullnessOf(String(ci.fullness ?? "0")) };
  const p = parseEstimatorCurtainDesc(it.desc || "", new Set(fabrics.map((f) => f.name)));
  if (p) {
    const fabric = fabrics.find((f) => f.name === p.fabricName)?.sku || fallbackFabric;
    return { ...base, name: p.name, fabric, width: String(p.widthFt), height: String(p.heightFt), fullness: fullnessOf(String(p.fullnessPct)) };
  }
  return { ...base, name: (it.desc || "").split(" — ")[0].trim(), fabric: fallbackFabric, width: "", height: "", fullness: "50" };
}

/** The structured inputs a curtain line stores (`SpecItem.curtainInputs`), read back by Edit curtain and the cut sheets. */
export function curtainInputsOf(d: CurtainDraft, fab: { sku: string; name: string }): CurtainRequest {
  let qty = parseInt(d.qty, 10);
  if (isNaN(qty) || qty < 1) qty = 1;
  const curtainInputs: CurtainRequest = {
    name: (d.name || "").trim(),
    fabricSku: fab.sku,
    fabricName: fab.name,
    qty: String(qty),
    width: String(parseFloat(d.width) || 0),
    height: String(parseFloat(d.height) || 0),
    fullness: fullnessOf(d.fullness),
  };
  if (isTopFinish(d.topFinish)) curtainInputs.topFinish = d.topFinish;
  if (isBottomFinish(d.bottomFinish)) curtainInputs.bottomFinish = d.bottomFinish;
  if (isMountTypeId(d.mountType)) curtainInputs.mountType = d.mountType;
  return curtainInputs;
}

/**
 * The curtain line Update curtain writes — the same line addCurtain builds
 * inline (estimator-client.tsx; harness-pinned there), desc format included.
 */
export function curtainItem(d: CurtainDraft, c: Pick<CurtainCalc, "fab" | "costEach" | "priceEach">, ids: { id: number; sku: string; trackKey?: string }): SpecItem {
  const name = (d.name || "").trim();
  let qty = parseInt(d.qty, 10);
  if (isNaN(qty) || qty < 1) qty = 1;
  const width = parseFloat(d.width) || 0;
  const height = parseFloat(d.height) || 0;
  const curtainInputs = curtainInputsOf(d, c.fab);
  const item: SpecItem = {
    id: ids.id,
    sku: ids.sku,
    desc: name + " — " + c.fab.name + ", " + width + "'W × " + height + "'H, " + d.fullness + "% fullness",
    qty,
    unit: "ea",
    cost: c.costEach,
    price: c.priceEach,
    curtain: true,
    curtainInputs,
    specKey: curtainSpecKey(undefined, name) || undefined,
  };
  if (ids.trackKey) item.curtainTrackKey = ids.trackKey;
  return item;
}

/** Update curtain (+ optional Add track): replace in place; a new track goes right after the curtain, both keyed. */
export function applyCurtainEdit(sec: SpecSection, lineId: number, item: SpecItem, track: SpecItem | null): SpecSection {
  const next = replaceCurtainLine(sec, lineId, item);
  if (!track) return next;
  const at = next.items.findIndex((it) => it.id === lineId);
  const curtain = next.items[at];
  const key = curtain.curtainTrackKey || newCurtainTrackKey(lineId);
  const items = next.items.slice();
  items[at] = { ...curtain, curtainTrackKey: key };
  items.splice(at + 1, 0, { ...track, curtainTrackKey: key });
  return { ...next, items };
}

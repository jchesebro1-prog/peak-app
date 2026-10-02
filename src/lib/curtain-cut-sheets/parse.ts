/**
 * Curtain cut sheets (#292) — reading a curtain back from the line text
 * (spec §2.1). Pure. A desc that doesn't match EXACTLY reads as null: the
 * collector flags the line, it never guesses a size.
 */
import { GRID_CURTAIN_TYPES, type GridCurtainType } from "@/lib/design/grid-bom";

export type CurtainSize = { widthFt: number; heightFt: number };
export type ParsedEstimatorDesc = { name: string; fabricName: string; widthFt: number; heightFt: number; fullnessPct: number };

const SEP = " — ";
/** addCurtain's tail (estimator-client.tsx): ", <W>'W × <H>'H, <F>% fullness" at the very end. */
const EST_TAIL = /, (\d+(?:\.\d+)?)'W × (\d+(?:\.\d+)?)'H, (\d+)% fullness$/;

/**
 * `<name> — <fabric>, <W>'W × <H>'H, <F>% fullness`. The head splits at the
 * LAST " — " whose right side is a known fabric name (so a name may itself
 * contain " — "); with no such match, at the first " — ".
 */
export function parseEstimatorCurtainDesc(desc: string, fabricNames: ReadonlySet<string>): ParsedEstimatorDesc | null {
  const s = (desc || "").trim();
  const m = EST_TAIL.exec(s);
  if (!m) return null;
  const head = s.slice(0, m.index);
  let cut = -1;
  let i = head.lastIndexOf(SEP);
  while (i > 0) {
    if (fabricNames.has(head.slice(i + SEP.length).trim())) {
      cut = i;
      break;
    }
    i = head.lastIndexOf(SEP, i - 1);
  }
  if (cut < 0) cut = head.indexOf(SEP);
  if (cut <= 0) return null;
  const name = head.slice(0, cut).trim();
  const fabricName = head.slice(cut + SEP.length).trim();
  if (!name || !fabricName) return null;
  return { name, fabricName, widthFt: Number(m[1]), heightFt: Number(m[2]), fullnessPct: Number(m[3]) };
}

const GRID_RE = new RegExp(
  `^(.+) \\((${GRID_CURTAIN_TYPES.join("|")})\\) · (\\d+(?:\\.\\d+)?)×(\\d+(?:\\.\\d+)?) ft · (?:(\\d+)% fullness|flat) · (.+)$`
);

/** grid-bom `curtainDesc`: `<name> (<type>) · <W>×<H> ft · <F>% fullness|flat · <fabric>`. */
export function parseGridCurtainDesc(desc: string): (ParsedEstimatorDesc & { gridType: GridCurtainType }) | null {
  const m = GRID_RE.exec((desc || "").trim());
  if (!m) return null;
  return {
    name: m[1].trim(),
    gridType: m[2] as GridCurtainType,
    widthFt: Number(m[3]),
    heightFt: Number(m[4]),
    fullnessPct: m[5] ? Number(m[5]) : 0,
    fabricName: m[6].trim(),
  };
}

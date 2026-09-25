import { getDoc, listDocs, upsertDoc, type Doc } from "@/db/doc-store";
import { GRID_CURTAIN_TYPES, type GridCurtainType } from "@/lib/design/grid-bom";

/**
 * One template per Grid curtain type (D-SPEC). The Grid mints SKU "CURTAIN" for
 * every curtain, so a curtain row can never match a catalog part — it resolves
 * to its type's template instead, and the placement's own configuration fills
 * the slots. The specimen's seven drape entries collapse into these four types
 * plus fabric: a valance is a Border in velour, a scrim or cyclorama is a Full
 * drop in scrim or muslin.
 */

export type CurtainFullnessKey = "0" | "50" | "75" | "100";

export type SpecCurtainTemplate = {
  id: GridCurtainType;
  /** The Part 2 article these entries print under. */
  articleId: string;
  sort: number;
  title: string;
  /** Outline text with {{name}} {{material}} {{color}} {{fullness}}
   *  {{fullnessClause}} {{hang}} {{width}} {{height}} slots. */
  body: string;
  fullnessClauses: Record<CurtainFullnessKey, string>;
  hang: string;
  defaultColor: string;
  updatedAt: number;
  updatedBy: string;
};

const FULLNESS_KEYS: CurtainFullnessKey[] = ["0", "50", "75", "100"];

function normalize(raw: unknown): SpecCurtainTemplate {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const src = (o.fullnessClauses && typeof o.fullnessClauses === "object"
    ? o.fullnessClauses
    : {}) as Record<string, unknown>;
  const fullnessClauses = {} as Record<CurtainFullnessKey, string>;
  for (const k of FULLNESS_KEYS) fullnessClauses[k] = String(src[k] || "").trim();
  const id = GRID_CURTAIN_TYPES.includes(o.id as GridCurtainType)
    ? (o.id as GridCurtainType)
    : GRID_CURTAIN_TYPES[0];
  return {
    id,
    articleId: String(o.articleId || ""),
    sort: Number(o.sort) || 0,
    title: String(o.title || "").trim(),
    body: typeof o.body === "string" ? o.body : "",
    fullnessClauses,
    hang: String(o.hang || "").trim(),
    defaultColor: String(o.defaultColor || "").trim(),
    updatedAt: Number(o.updatedAt) || 0,
    updatedBy: String(o.updatedBy || ""),
  };
}

const BODY = [
  "Basis of Design: {{name}}",
  "  Material: {{material}}",
  "  Color: {{color}}",
  "  Size: {{width}} feet wide by {{height}} feet high, finished.",
  "  Fabrication: {{fullnessClause}}",
  "  Hang Method: {{hang}}",
].join("\n");

const CLAUSES: Record<CurtainFullnessKey, string> = {
  "0": "Flat, seamed and hemmed without fullness.",
  "50": "Sewn to 50 percent fullness, with vertical seams sewn flat and interlocked.",
  "75": "Sewn to 75 percent fullness, with vertical seams sewn flat and interlocked.",
  "100": "Sewn to 100 percent fullness, with vertical seams sewn flat and interlocked.",
};

export const STARTER_CURTAIN_TEMPLATES: Array<Omit<SpecCurtainTemplate, "updatedAt" | "updatedBy">> = [
  { id: "Border", articleId: "", sort: 10, title: "Borders", body: BODY, fullnessClauses: CLAUSES, hang: "Webbing and grommets on 12 inch centers along the top edge, with tie lines at each grommet.", defaultColor: "Black unless noted otherwise" },
  { id: "Leg", articleId: "", sort: 20, title: "Legs", body: BODY, fullnessClauses: CLAUSES, hang: "Webbing and grommets on 12 inch centers along the top edge, with tie lines at each grommet.", defaultColor: "Black unless noted otherwise" },
  { id: "Draw", articleId: "", sort: 30, title: "Draw Curtains", body: BODY, fullnessClauses: CLAUSES, hang: "Webbing and grommets on 12 inch centers, hung from carriers on the track specified in this section, with an overlap arm at the center.", defaultColor: "Black unless noted otherwise" },
  { id: "Full", articleId: "", sort: 40, title: "Full Stage Drops", body: BODY, fullnessClauses: CLAUSES, hang: "Webbing and grommets on 12 inch centers along the top edge, with a chain pocket along the bottom hem.", defaultColor: "Black unless noted otherwise" },
];

export async function allCurtainTemplates(): Promise<SpecCurtainTemplate[]> {
  const list = await listDocs<Doc>("spec_curtain_templates");
  return list.map(normalize).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}

export async function getCurtainTemplate(type: GridCurtainType): Promise<SpecCurtainTemplate | null> {
  const raw = await getDoc<Doc>("spec_curtain_templates", type);
  return raw ? normalize(raw) : null;
}

export async function saveCurtainTemplate(
  input: Omit<SpecCurtainTemplate, "updatedAt" | "updatedBy">,
  by: string
): Promise<SpecCurtainTemplate> {
  const rec = normalize({ ...input, updatedAt: Date.now(), updatedBy: by });
  await upsertDoc<SpecCurtainTemplate>("spec_curtain_templates", rec);
  return rec;
}

/** Idempotent by curtain type. */
export async function seedStarterCurtainTemplates(by = "Peak"): Promise<number> {
  const have = new Set((await allCurtainTemplates()).map((t) => t.id));
  let made = 0;
  for (const t of STARTER_CURTAIN_TEMPLATES) {
    if (have.has(t.id)) continue;
    await saveCurtainTemplate(t, by);
    made++;
  }
  return made;
}

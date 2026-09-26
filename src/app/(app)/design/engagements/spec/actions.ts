"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getDoc } from "@/db/doc-store";
import {
  assemble,
  type BomRow,
  matchBom,
  type MatchedRow,
  type SpecCatalogPart,
  withStoredParts,
} from "@/lib/bid-spec";
import { list as listCatalog, mergeUpsert } from "@/lib/stores/catalog";
import { getEngagement } from "@/lib/stores/engagements";
import { allSections, createSection, seedStarterSections, updateSection } from "@/lib/stores/spec-sections";
import { allArticles } from "@/lib/stores/spec-articles";
import { saveGeneratedSpec } from "@/lib/stores/generated-specs";
import { toArticles } from "@/lib/specs/sections";
import { hasPrintableSpec } from "@/lib/specs/articles";
import { gridSpecBomRows, parseVirtualPartId } from "@/lib/design/grid-virtual-parts";
import { listFixtures } from "@/lib/stores/fixtures";

/**
 * Bid-spec generator actions (D94). The catalog is the spec library: a
 * part's Part 2 paragraph lives on the part itself, so language and product
 * can never drift apart.
 */

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

/** Pull an equipment list out of a quote's spec subdoc — the estimator's
 *  nested sections, or the flat `lines` shape The Grid mints (D111). */
type QuoteSpecDoc = {
  id: string;
  spec?: {
    sections?: Array<{ items?: Array<{ sku?: string; desc?: string; qty?: number; option?: boolean; labor?: boolean }> }>;
    lines?: Array<{ sku?: string; desc?: string; qty?: number; allowance?: boolean }>;
  };
};

export async function bomFromQuoteAction(quoteId: string): Promise<Result<{ bom: BomRow[] }>> {
  await requireUser();
  const q = await getDoc<QuoteSpecDoc>("quotes", quoteId);
  if (!q) return { ok: false, error: `Quote ${quoteId} not found.` };
  const rows: BomRow[] = [];
  const push = (sku: unknown, desc: unknown, qty: unknown) => {
    const s = String(sku || "").trim();
    const d = String(desc || "").trim();
    if (!s && !d) return;
    rows.push({ sku: s, desc: d, qty: Number(qty) || 0 });
  };
  for (const sec of q.spec?.sections || []) {
    for (const it of sec.items || []) {
      // Optional-scope lines are not part of the base bid; labor lines
      // (mobilizations, shop & engineering, allowance, performance bonus)
      // aren't equipment and don't belong in the bid-spec BOM either.
      if (it.option || it.labor) continue;
      push(it.sku, it.desc, it.qty);
    }
  }
  // The Grid's flat lines (#211, D316): allowances are left out like the
  // estimator's allowance/labor lines; an Auto assembly (asm:) expands into
  // its members. Fixtures load once, and only when an assembly line exists.
  const gridLines = q.spec?.lines || [];
  const fixtures = gridLines.some((l) => parseVirtualPartId(String(l.sku || "").trim())?.kind === "assembly")
    ? new Map((await listFixtures()).map((f) => [f.id, f]))
    : new Map();
  for (const it of gridSpecBomRows(gridLines, (id) => fixtures.get(id))) push(it.sku, it.desc, it.qty);
  if (!rows.length) {
    return { ok: false, error: `Quote ${quoteId} has no equipment lines to specify.` };
  }
  return { ok: true, bom: rows };
}

/** Match a BOM against the catalog. Returns a serializable report. */
export async function matchBomAction(bom: BomRow[]): Promise<Result<{ rows: MatchedRow[] }>> {
  await requireUser();
  if (!Array.isArray(bom) || !bom.length) {
    return { ok: false, error: "The equipment list is empty." };
  }
  const catalog = (await listCatalog()) as SpecCatalogPart[];
  const rep = matchBom(bom, catalog);
  return { ok: true, rows: rep.rows };
}

/** Map a no-match row onto a specific catalog part the user picked. */
export async function remapRowAction(
  rows: MatchedRow[],
  index: number,
  sku: string
): Promise<Result<{ rows: MatchedRow[] }>> {
  await requireUser();
  const catalog = (await listCatalog()) as SpecCatalogPart[];
  const part = catalog.find((p) => p.sku.toLowerCase() === sku.trim().toLowerCase());
  if (!part) return { ok: false, error: `No catalog part with SKU ${sku}.` };
  const next = rows.map((r, i) =>
    i === index
      ? {
          ...r,
          part,
          candidates: [],
          bucket: hasPrintableSpec(part) ? ("ready" as const) : ("no-spec" as const),
        }
      : r
  );
  return { ok: true, rows: next };
}

/** Write a Part 2 paragraph onto a catalog part — the authoring path that
 *  turns a 'no-spec' row into a 'ready' one, done inline during a match. */
export async function writePartSpecAction(
  sku: string,
  specSectionId: string,
  specBody: string
): Promise<Result> {
  const user = await requireUser();
  const body = String(specBody || "").trim();
  if (!body) return { ok: false, error: "The spec paragraph is empty." };
  if (!specSectionId) return { ok: false, error: "Pick the section this product belongs in." };
  const catalog = (await listCatalog()) as SpecCatalogPart[];
  const part = catalog.find((p) => p.sku === sku);
  if (!part) return { ok: false, error: `No catalog part with SKU ${sku}.` };
  // D258 mirror invariant (src/lib/stores/catalog.ts ~149-155):
  // specSectionId is written only as a MIRROR of specArticleId's own section.
  // This inline write sets specSectionId directly (there is no article picker
  // here) — if the part already carries a specArticleId pointing at an
  // article in a DIFFERENT section, clear it so the pair never disagrees.
  const articles = await allArticles();
  const currentArticle = part.specArticleId ? articles.find((a) => a.id === part.specArticleId) : undefined;
  const clearsArticle = !!currentArticle && currentArticle.sectionId !== specSectionId;
  // mergeUpsert, never upsert: `part` may be stale by the time this write
  // lands (another save in between) and a bare upsert would replace the
  // whole document, silently wiping ports/trade/datasheet/pricing fields.
  await mergeUpsert(sku, {
    specSectionId,
    specBody: body,
    ...(clearsArticle ? { specArticleId: undefined } : {}),
    // An inline D94 write is a human writing the text — the review step.
    specState: "authored",
    specSource: "authored",
    specUpdatedAt: Date.now(),
    specUpdatedBy: user.name,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveSpecAction(input: {
  engagementId: string;
  source: string;
  bom: BomRow[];
  rows: MatchedRow[];
}): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const eng = await getEngagement(input.engagementId);
  if (!eng) return { ok: false, error: "Engagement not found." };
  const unresolved = input.rows.filter((r) => r.bucket !== "ready" && !r.waived);
  if (unresolved.length) {
    return {
      ok: false,
      error: `${unresolved.length} item${unresolved.length === 1 ? "" : "s"} still need a spec or an explicit waive.`,
    };
  }
  // A part can be demoted to draft (Task 14's importer) between match and
  // save — re-read the catalog rather than trust the client-sent bucket.
  const stored = new Map(((await listCatalog()) as SpecCatalogPart[]).map((p) => [p.sku.toLowerCase(), p]));
  const nowMissing = input.rows.filter((r) => {
    if (r.waived || !r.part) return false;
    const part = stored.get(r.part.sku.toLowerCase());
    return !hasPrintableSpec(part);
  });
  if (nowMissing.length) {
    const n = nowMissing.length;
    return {
      ok: false,
      error: `${n} item${n === 1 ? "" : "s"} no longer ha${n === 1 ? "s" : "ve"} approved spec text — re-run the match.`,
    };
  }
  const sections = await allSections();
  // Print the STORED part's title/body/article/section, never whatever the
  // client happened to be holding when it posted the save — the spec has to
  // read as the authored, reviewed text even if the row was matched a while
  // ago and something (Task 14's importer, a concurrent edit) touched the
  // part since.
  const spec = assemble(withStoredParts(input.rows, stored), sections, {
    projectName: eng.name,
    customer: eng.customer,
    engagementId: eng.id,
    preparedBy: user.name,
    date: Date.now(),
  });
  const rec = await saveGeneratedSpec({
    engagementId: eng.id,
    source: input.source,
    bom: input.bom,
    spec,
    by: user.name,
  });
  revalidatePath("/", "layout");
  return { ok: true, id: rec.id };
}

/* ---------- section library ---------- */

export async function createSectionAction(input: {
  number: string;
  title: string;
  sort?: number;
}): Promise<Result> {
  const user = await requireUser();
  if (!input?.number?.trim() || !input?.title?.trim()) {
    return { ok: false, error: "A section needs a number and a title." };
  }
  await createSection({ ...input, by: user.name });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateSectionAction(
  id: string,
  patch: { number?: string; title?: string; sort?: number; part1?: string; part3?: string }
): Promise<Result> {
  const user = await requireUser();
  const { part1, part3, ...rest } = patch;
  await updateSection(
    id,
    {
      ...rest,
      ...(part1 !== undefined ? { part1: toArticles(part1) } : {}),
      ...(part3 !== undefined ? { part3: toArticles(part3) } : {}),
    },
    user.name
  );
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function seedSectionsAction(): Promise<Result<{ made: number }>> {
  const user = await requireUser();
  const made = await seedStarterSections(user.name);
  revalidatePath("/", "layout");
  return { ok: true, made };
}

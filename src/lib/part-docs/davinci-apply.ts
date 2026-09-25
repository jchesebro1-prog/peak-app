import { createHash } from "node:crypto";
import { listDocs } from "@/db/doc-store";
import { mfrKey } from "@/lib/catalog-books";
import { peakMfrFor } from "@/lib/catalog-davinci-apply";
import { loadExtract } from "@/lib/davinci/load";
import { list as allParts } from "@/lib/stores/catalog";
import { syncAccessoryLinks } from "@/lib/stores/part-accessory-links";
import { allDocuments, createDocument, ensureLinks } from "@/lib/stores/part-documents";
import { planDavinciPrefill, type PrefillPlan } from "./davinci-prefill";

/**
 * DaVinci pre-fill, the writing half (#DOC, spec §6). Server/script only.
 * Writes link-only `part_documents` (source "davinci", sourceUrl only — no
 * ETC file is downloaded or rehosted), their part links, and the "davinci"
 * scope of `part_accessory_links`. Idempotent: document ids derive from the
 * URL, links a human detached stay detached (ensureLinks), and the graph
 * scope is synced (a pair ETC dropped from the library is soft-deleted).
 */

/** Deterministic per URL, so a re-run never mints a second document. */
export function davinciDocumentId(url: string): string {
  return `PD-D${createHash("sha1").update(url).digest("hex").slice(0, 15)}`;
}

/** Plan against the committed extract and the ETC-scoped catalog. */
export async function planPrefillFromDavinci(): Promise<PrefillPlan> {
  const wanted = mfrKey("ETC");
  const parts = (await allParts()).filter((p) => mfrKey(p.mfr) === wanted);
  return planDavinciPrefill(loadExtract(), parts, (m) => {
    const peak = peakMfrFor({ manufacturer: m });
    return !!peak && mfrKey(peak) === wanted;
  });
}

export type PrefillResult = { documentsCreated: number; linksCreated: number; accessoryWritten: number; accessoryRemoved: number };

export async function applyPrefill(plan: PrefillPlan, by: string): Promise<PrefillResult> {
  const everIds = new Set((await listDocs("part_documents", { includeDeleted: true })).map((d) => d.id));
  const byUrl = new Map<string, string>();
  for (const d of await allDocuments()) if (d.sourceUrl && !byUrl.has(d.sourceUrl)) byUrl.set(d.sourceUrl, d.id);

  let documentsCreated = 0;
  const pairs: Array<{ partSku: string; documentId: string; kind: "datasheet" }> = [];
  for (const d of plan.documents) {
    let id = byUrl.get(d.url);
    if (!id) {
      id = davinciDocumentId(d.url);
      if (!everIds.has(id)) {
        const created = await createDocument({
          id,
          kind: "datasheet",
          title: d.label,
          fileName: `${d.label.replace(/[\\/]+/g, "-").trim() || "Datasheet"}.pdf`,
          contentType: "application/pdf",
          size: 0,
          blobKey: null,
          sourceUrl: d.url,
          source: "davinci",
          sourceRef: d.typeId,
          language: "en",
          by,
        });
        if (created) documentsCreated++;
        everIds.add(id);
      }
      byUrl.set(d.url, id);
    }
    for (const sku of d.skus) pairs.push({ partSku: sku, documentId: id, kind: "datasheet" });
  }
  const linksCreated = await ensureLinks(pairs, by);
  const acc = await syncAccessoryLinks({ source: "davinci" }, plan.accessoryPairs);
  return { documentsCreated, linksCreated, accessoryWritten: acc.written, accessoryRemoved: acc.removed };
}

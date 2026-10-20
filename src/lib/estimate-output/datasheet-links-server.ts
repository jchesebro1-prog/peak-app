import type { Quote } from "@/lib/stores/quotes";
import { datasheetLinkPath } from "./datasheet-link";
import { datasheetLinkRows, type DatasheetLinkRow } from "./datasheet-links";
import { specPackageDocs } from "./package-docs-server";

/** The live quote's datasheet link rows, absolute on `origin` (the print origin). Never throws: no secret,
 *  no origin or a failed read → no rows (the PDF simply has no links page). A row links only what
 *  /d/ds/ will serve (packageDocForSpec, datasheets only): listed, datasheet kind, a stored file. Server-only. */
export async function loadDatasheetLinkRows(q: Pick<Quote, "id" | "spec" | "packageSelection">, origin: string, secret: string = process.env.AUTH_SECRET || ""): Promise<DatasheetLinkRow[]> {
  if (!secret || !origin) return [];
  try {
    const d = await specPackageDocs(q.spec, q.packageSelection ?? null);
    return datasheetLinkRows({
      bom: d.bom,
      parts: d.parts,
      documents: d.documents,
      hosted: (id) => {
        const doc = d.index.docsById.get(id);
        return !!doc?.blobKey && doc.kind === "datasheet";
      },
      href: (id) => origin + datasheetLinkPath(secret, q.id, id),
    });
  } catch (e) {
    console.warn("[quote-pdf] datasheet links unavailable", q.id, e instanceof Error ? e.message : e);
    return [];
  }
}

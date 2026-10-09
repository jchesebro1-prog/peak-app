"use server";

import { revalidatePath } from "next/cache";
import { GRID_ESTIMATE_LOCK_NAMESPACE, withAdvisoryLock } from "@/db";
import { requirePerm } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";
import { createProject, getProject, gridProjectForQuote, linkOptionToEstimate, setProjectCustomer } from "@/lib/stores/grid-projects";
import { createDesign } from "@/lib/stores/designs";
import { ensureGridSymbolsFor } from "@/lib/stores/grid-catalog";
import { defaultOptionId } from "@/lib/design/grid-options";
import { siteForLocId } from "@/lib/design/grid-intake";
import { sitesForCompany } from "@/lib/identity/sites";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { estimateTrayParts } from "@/lib/design/estimate-tray-server";
import { GRID_LINK_COPY, quoteQualifiesForGrid } from "@/lib/design/estimate-grid-link";

/**
 * #314 — "Design in the Grid" (Build package step): open the Grid design that
 * draws this estimate, creating it the first time. The new design is made
 * exactly like Design → New design (createManualDesignAction: a Grid project
 * + a manual-layout design record), pre-linked to the quote's customer,
 * contact and venue, titled from the quote, and its base option is linked to
 * the estimate as estimate-owned — drawings only; the estimate keeps its
 * parts and prices. Every placeable BOM part gets a Grid library entry so the
 * "From estimate" tray resolves. The check-then-create runs under an advisory
 * lock per quote, so a double-click never makes two designs.
 */
export async function openGridDesignForQuoteAction(
  quoteId: string
): Promise<{ ok: true; projectId: string; created: boolean } | { ok: false; error: string }> {
  const user = await requirePerm("create");
  const id = typeof quoteId === "string" ? quoteId.trim() : "";
  if (!id) return { ok: false, error: GRID_LINK_COPY.saveFirst };
  const q = await getQuote(id);
  if (!q) return { ok: false, error: GRID_LINK_COPY.gone };
  if (!quoteQualifiesForGrid(q)) return { ok: false, error: GRID_LINK_COPY.notSystem };

  let created = false;
  let projectId: string;
  try {
    projectId = await withAdvisoryLock(GRID_ESTIMATE_LOCK_NAMESPACE, q.id, async () => {
      const hit = await gridProjectForQuote(q.id);
      if (hit) return hit.project.id;
      const site = q.customerId && q.locationId ? siteForLocId(await sitesForCompany(q.customerId), q.locationId) : null;
      const project = await createProject({
        name: (q.name || "").trim() || displayQuoteNumber(q),
        customer: q.customer || "",
        customerId: q.customerId || null,
        by: user.name,
      });
      await setProjectCustomer(project.id, {
        customer: q.customer || "",
        customerId: q.customerId || null,
        contactName: q.contactName || "",
        siteId: site?.id ?? null,
        siteName: site ? site.name || "Unnamed venue" : "",
      });
      await createDesign({ name: project.name, owner: user.name, layoutMode: "manual", gridProjectId: project.id });
      const linked = await linkOptionToEstimate(project.id, defaultOptionId(project), q.id);
      if (!linked) throw new Error(`linkOptionToEstimate refused ${project.id} → ${q.id}`);
      created = true;
      return project.id;
    });
  } catch (e) {
    console.error("[grid] design from estimate failed", e);
    return { ok: false, error: "Couldn't start the Grid design — try again." };
  }

  if (created) {
    // Library entries are a convenience the tray can also add later (Sync parts) — never fail the open on them.
    try {
      await ensureGridSymbolsFor(await estimateTrayParts(q), user.name);
    } catch (e) {
      console.error("[grid] tray parts for a new estimate design failed", e);
    }
    revalidatePath("/design/designs");
  }
  if (!(await getProject(projectId))) return { ok: false, error: "Couldn't start the Grid design — try again." };
  return { ok: true, projectId, created };
}

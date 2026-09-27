import { blobEnabled } from "@/lib/blob";
import { requireUser } from "@/lib/session";
import { get as getCustomer } from "@/lib/stores/customers";
import { getAllProjects } from "@/lib/stores/projects";
import { documentCategories, documentsForCustomer } from "@/lib/stores/documents";
import { activeDocumentCategories } from "@/lib/document-categories";
import { documentRows } from "@/lib/document-rules";
import { shortDate } from "@/lib/format";
import { DocumentsCardClient } from "./documents-card-client";

/**
 * <DocumentsCard customerId siteId? projectId?> (#218) — server component.
 * Company scope: every file of the company. Venue scope (siteId): files at
 * that venue, uploads default to it. Project scope (projectId): the
 * project's files, uploads go on the project (the server files them under
 * the project's venue when that venue is the company's). Loads everything
 * the client card needs and passes it as serializable props — the client
 * never sees a blob path.
 */
export async function DocumentsCard({
  customerId,
  siteId = null,
  projectId = null,
}: {
  customerId: string | null;
  siteId?: string | null;
  projectId?: string | null;
}) {
  // Every host page already requires a user; the card re-checks so it can
  // never be dropped onto an unauthenticated page by accident.
  await requireUser();
  if (!customerId) {
    return (
      <div
        id="documents"
        className="pk-card"
        style={{ padding: "22px 18px", marginBottom: 24, fontSize: 12.5, color: "#9aa0ab", textAlign: "center" }}
      >
        Link this project to a company to keep its documents.
      </div>
    );
  }
  const [cust, projects, categories, docs] = await Promise.all([
    getCustomer(customerId),
    getAllProjects(),
    documentCategories(),
    documentsForCustomer(customerId, projectId ? { projectId } : siteId ? { siteId } : {}),
  ]);
  if (!cust) return null;
  // `locations[].id` is the docLocId — the id a document's siteId carries.
  const venues = (cust.locations || []).flatMap((l) => (l.id ? [{ id: l.id, label: l.label || l.locationName || "Venue" }] : []));
  const custProjects = projects
    .filter((p) => p.customerId === customerId)
    .map((p) => ({ id: p.id, label: p.name || p.id }));
  return (
    <DocumentsCardClient
      customerId={customerId}
      scope={projectId ? "project" : siteId ? "venue" : "company"}
      fixedSiteId={siteId}
      fixedProjectId={projectId}
      rows={documentRows(docs, { categories, venues, projects: custProjects }).map((r) => ({
        ...r,
        dateLabel: shortDate(r.uploadedAt),
      }))}
      categories={activeDocumentCategories(categories).map((c) => ({ key: c.key, label: c.label }))}
      venues={venues}
      projects={custProjects}
      blobOn={blobEnabled()}
    />
  );
}

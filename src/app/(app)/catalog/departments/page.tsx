import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { portalIndex } from "@/lib/portal-catalog-index";
import { getDepartments } from "@/lib/stores/portal-departments";
import { partCategoryStats, suggestDepartments } from "@/lib/portal-departments";
import DepartmentsEditor from "./departments-editor";

export const metadata = { title: "Departments — Quartzite-6" };
export const dynamic = "force-dynamic";

/**
 * Catalog → Departments (#252, spec pick 7): the named grouping of catalog
 * categories that drives the portal's department tree. Every part category
 * the portal index carries is offered with its part count — #289:
 * departments hold parts only; fixture assemblies browse under the portal's
 * own Packages & Assemblies section instead. Suggestions are computed here
 * so "Start from suggestions" needs no round trip.
 */
export default async function DepartmentsPage() {
  const user = await requireUser();
  if (!can("manage_users", user.roles)) {
    return (
      <div className="pk-content" style={{ maxWidth: 960 }}>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", marginBottom: 20 }}>Departments</div>
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>
            Grouping catalog categories into portal departments is limited to admins.
          </div>
        </div>
      </div>
    );
  }

  const [ix, departments] = await Promise.all([portalIndex(), getDepartments()]);
  // Per part category (#289: parts only): its part count, and a part count per manufacturer
  // (suggestDepartments' (k) dominant-manufacturer fallback reads this —
  // production categories are mostly bare brand product-family names, so
  // name keywords alone classify only a fraction of them).
  const categoryStats = partCategoryStats(ix.entries);
  const suggestions = suggestDepartments(categoryStats);
  // The client only ever needs category + count (the row list, the filter,
  // the bulk-move helper) — manufacturer data is what suggestDepartments
  // needed server-side to classify a pure product-family name; it never
  // needs to cross the wire. "Re-run suggestions" reuses this same
  // server-computed `suggestions` array rather than re-deriving anything
  // client-side, so the client component never needs `mfrs` either.
  const categories = categoryStats.map(({ category, count }) => ({ category, count }));

  return (
    <div className="pk-content" style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 18 }}>
        <Link href="/catalog" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>
          ← Catalog
        </Link>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", marginTop: 6 }}>Departments</div>
        <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5, lineHeight: 1.5, maxWidth: 780 }}>
          Group catalog categories into named departments — the portal catalog shows a tile per department, with
          anything left over falling into an automatic <em>Other</em>. A category belongs to at most one department.
        </div>
      </div>
      <DepartmentsEditor departments={departments} categories={categories} suggestions={suggestions} />
    </div>
  );
}

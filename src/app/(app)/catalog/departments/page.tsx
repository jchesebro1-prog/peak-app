import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { portalIndex } from "@/lib/portal-catalog-index";
import { getDepartments } from "@/lib/stores/portal-departments";
import { suggestDepartments } from "@/lib/portal-departments";
import DepartmentsClient from "./departments-client";

export const metadata = { title: "Departments — Quartzite-6" };
export const dynamic = "force-dynamic";

/**
 * Catalog → Departments (#251, spec pick 7): the named grouping of catalog
 * categories that drives the portal's department tree. Every raw category
 * the portal index carries (including the "Fixture assemblies" pseudo-
 * category, spec pick 6) is offered with its part count; suggestions are
 * computed here so "Start from suggestions" needs no round trip.
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
  const counts = new Map<string, number>();
  for (const e of ix.entries) {
    const cat = e.category || "—";
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  const categories = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  const suggestions = suggestDepartments(categories.map((c) => c.category));

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
      <DepartmentsClient key={JSON.stringify(departments)} departments={departments} categories={categories} suggestions={suggestions} />
    </div>
  );
}

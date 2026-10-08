import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getManyBySku } from "@/lib/stores/catalog";
import { getSystemCategories } from "@/lib/stores/system-categories";
import SystemCategoriesClient from "./system-categories-client";
import type { CategoryPartInfo } from "./actions";

export const metadata = { title: "System categories — Estimating Rules — Quartzite-6" };
export const dynamic = "force-dynamic";

/**
 * Estimating Rules → System categories (Estimator Phase 6): the typical parts
 * that pre-fill a new system from "+ Add system". Admin-only (manage_users),
 * like the rest of Estimating Rules. Read-only on load — the categories blob
 * (defaults when never saved) and ONLY the catalog SKUs they reference, so each
 * item shows its live description and cost and a SKU that has left the catalog
 * shows as missing.
 */
export default async function SystemCategoriesPage() {
  const user = await requireUser();
  const back = (
    <Link href="/estimating-rules" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>
      ← Estimating rules
    </Link>
  );
  if (!can("manage_users", user.roles)) {
    return (
      <div className="pk-content" style={{ maxWidth: 960 }}>
        {back}
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", margin: "6px 0 20px" }}>System categories</div>
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>
            System categories decide which catalog parts pre-fill a new system, so editing them is limited to admins.
          </div>
        </div>
      </div>
    );
  }

  const categories = await getSystemCategories();
  const skus = [...new Set(categories.flatMap((c) => c.items.map((i) => i.sku)))];
  const found = skus.length ? await getManyBySku(skus) : new Map();
  const parts: Record<string, CategoryPartInfo | null> = {};
  for (const s of skus) {
    const p = found.get(s);
    parts[s] = p ? { desc: p.desc, unit: p.unit || "ea", cost: p.cost || 0, list: p.list || 0 } : null;
  }

  return (
    <div className="pk-content" style={{ maxWidth: 1000 }}>
      {back}
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 6 }}>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em" }}>System categories</div>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: ".06em",
            color: "#8a6d1f",
            background: "#fbf3dd",
            border: "1px solid #f0e2bd",
            padding: "3px 9px",
            borderRadius: 6,
          }}
        >
          ADMIN
        </span>
      </div>
      <div style={{ fontSize: 13.5, color: "#8c919c", margin: "4px 0 18px", lineHeight: 1.5 }}>
        The typical parts that pre-fill a new system on the Estimator. Pick a category when adding a system and its parts
        come in priced from the live catalog; the person adding can untick or change any of them.
      </div>
      <SystemCategoriesClient initial={categories} parts={parts} />
    </div>
  );
}

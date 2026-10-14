import Link from "next/link";
import { requirePerm } from "@/lib/session";
import { ASSESSMENT_DEF } from "@/lib/assessments/defs";
import { getPicklistExtras } from "@/lib/stores/assessment-picklists";
import { pickListAdminRows } from "@/lib/assessments/integration";
import PickListAdmin from "./controls";

export const metadata = { title: "Pick lists — Quartzite-6" };

/**
 * Pick-list admin (#340, Task 11): every code list the assessment asks from, with its built-in values (read-only)
 * and the values added here. An added value can be retired (it stays valid on stored answers, it just stops being
 * offered) and brought back; nothing is ever deleted. Administrators only.
 */
export default async function PickListsPage() {
  await requirePerm("manage_users");
  const rows = pickListAdminRows(ASSESSMENT_DEF, await getPicklistExtras());
  return (
    <div className="pk-content" style={{ maxWidth: 880, margin: "0 auto" }}>
      <Link href="/assessments" style={{ display: "inline-block", fontSize: 12.5, fontWeight: 600, color: "#8c919c", textDecoration: "none", marginBottom: 14 }}>
        ‹ Assessments
      </Link>
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 6 }}>
        <span style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Pick lists</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "#9aa0ab" }}>{rows.length}</span>
      </div>
      <p style={{ fontSize: 13, color: "#5b616e", margin: "0 0 18px", maxWidth: 640 }}>
        Add a choice to any list the assessment offers. Built-in choices can&rsquo;t be changed. A retired choice stays on the answers already saved; it
        just stops being offered.
      </p>
      <PickListAdmin rows={rows} />
    </div>
  );
}

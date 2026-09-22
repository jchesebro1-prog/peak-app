import { requireUser } from "@/lib/session";
import { can, ROLES } from "@/lib/team";
import { activeUsers } from "@/lib/users";
import { allTaskTemplateSets } from "@/lib/stores/task-templates";
import TemplateSetsClient from "./template-sets-client";

export const metadata = { title: "Task Templates — Quartzite-6" };

/**
 * Task Templates admin screen (D149, #118) — Jeff's ask: "add template
 * tasks to projects, quotes, and designs that can be assigned based on
 * groups, people, or teams." Admin-only, gated on `manage_users` (the
 * closest existing permission — see DECISIONS.md D149), same pattern as
 * Estimating Rules (src/app/(app)/estimating-rules/page.tsx).
 */
export default async function TaskTemplatesPage() {
  const user = await requireUser();
  const isAdmin = can("manage_users", user.roles);

  const [sets, roster] = isAdmin
    ? await Promise.all([allTaskTemplateSets(), activeUsers()])
    : [[], []];

  return (
    <div className="pk-content" style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", rowGap: 12, marginBottom: 20 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em" }}>Task templates</div>
            <span
              style={{
                fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".06em",
                color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", padding: "3px 9px", borderRadius: 6,
              }}
            >
              ADMIN
            </span>
          </div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 4 }}>
            Reusable checklists for projects, quotes, and designs — assign each line to a
            person, a role, or the whole team.
          </div>
        </div>
      </div>

      {!isAdmin ? (
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#3a3f4a" }}>Admin access required</div>
          <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 6 }}>
            Task templates are edited by admins only. Ask an Admin to make changes here.
          </div>
        </div>
      ) : (
        <TemplateSetsClient
          initial={sets}
          people={roster.map((u) => ({ id: u.id, name: u.name }))}
          roles={ROLES}
        />
      )}
    </div>
  );
}

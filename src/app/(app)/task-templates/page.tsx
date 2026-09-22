import { requireUser } from "@/lib/session";
import { can, ROLES } from "@/lib/team";
import { activeUsers } from "@/lib/users";
import { allTaskTemplateSets } from "@/lib/stores/task-templates";
import { mergedConsultingPhases } from "@/lib/stores/engagements";
import { getSettings, mergedConsultingDisciplines } from "@/lib/settings";
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

  const [sets, roster, settings] = isAdmin
    ? await Promise.all([allTaskTemplateSets(), activeUsers(), getSettings()])
    : [[], [], null];

  // #145 D165 — the phase/discipline menus a line's Phase/Discipline
  // selects offer, computed server-side (same seam as the consulting quote
  // builder's phaseMenu) so template-sets-client.tsx — a client component —
  // never imports the settings/engagements store modules itself (see that
  // file's own comment on the 763febd production-build break).
  const phaseMenu = settings ? mergedConsultingPhases(settings.consultingPhases) : [];
  const disciplineMenu = settings ? mergedConsultingDisciplines(settings.consultingDisciplines) : [];

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
          phaseMenu={phaseMenu}
          disciplineMenu={disciplineMenu}
        />
      )}
    </div>
  );
}

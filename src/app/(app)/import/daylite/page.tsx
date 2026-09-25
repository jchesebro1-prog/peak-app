import Link from "next/link";
import { requirePerm } from "@/lib/session";
import { loadPipelines } from "@/lib/pipelines-server";
import { projectPipelineFor } from "@/lib/pipelines";
import { STAGE_META as REPAIR_STAGE_META } from "@/lib/stores/repair-jobs";
import { DayliteHistory, type StageLabels } from "./daylite-client";

export const metadata = { title: "Daylite history — Quartzite-6" };

/**
 * Route segment config applies to every Server Action invoked from this page
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
 * 02-route-segment-config/maxDuration.md → "Server Actions"). The client
 * already commits in chunks of 150 rows, each well inside 60s against Neon;
 * 300 is headroom for a slow chunk, not the plan. On Vercel, a value above
 * the plan's ceiling is clamped/refused at deploy (Hobby without Fluid
 * compute tops out at 60s).
 */
export const maxDuration = 300;

export default async function DayliteImportPage() {
  await requirePerm("manage_users");
  // Live-work stage names come from the CONFIGURED pipelines (Settings can
  // rename stages), resolved here so the client never imports a server store.
  const pipes = await loadPipelines();
  const labelsFor = (kind: "project" | "order") =>
    Object.fromEntries(projectPipelineFor(pipes, { kind }).stages.map((st) => [st.id, st.label]));
  const stageLabels: StageLabels = {
    project: labelsFor("project"),
    order: labelsFor("order"),
    repair: Object.fromEntries(Object.entries(REPAIR_STAGE_META).map(([k, m]) => [k, m.label])),
  };
  return (
    <div className="pk-content">
      <div style={{ marginBottom: 20 }}>
        <Link href="/import" style={{ fontSize: 12, color: "#8c919c", textDecoration: "none" }}>
          ← Import &amp; export
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Daylite history</div>
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
        <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5, maxWidth: 720, lineHeight: 1.5 }}>
          Past and live projects, service calls and open quotes from Daylite’s Projects and Opportunities
          exports. Preview first — nothing is written until you confirm, and a re-run skips anything already
          imported.
        </div>
      </div>
      <DayliteHistory stageLabels={stageLabels} />
    </div>
  );
}

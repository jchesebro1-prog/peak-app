import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { ProjectsView } from "./view";
import { loadProjectsData, one, normFilter } from "./data";

export const metadata = { title: "Projects — Quartzite-6" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, data] = await Promise.all([requireUser(), searchParams, loadProjectsData()]);
  // Legacy/cross-screen deep links use /projects?id=<id>; the detail lives at
  // /projects/[id]. Redirect so both link shapes resolve to the detail view.
  const idParam = one(sp.id);
  if (idParam) redirect(`/projects/${encodeURIComponent(idParam)}`);
  const filter = normFilter(one(sp.filter));
  // #19: list (default, stripped from URLs) | board — allowlisted like the
  // leads view param.
  const view = one(sp.view) === "board" ? ("board" as const) : ("list" as const);

  return (
    <ProjectsView
      projects={data.projects}
      pending={data.pending}
      sel={null}
      filter={filter}
      tab="overview"
      view={view}
      custById={data.custById}
      identity={data.identity}
      roster={data.roster}
      taskRows={data.taskRows}
      people={data.people}
    />
  );
}

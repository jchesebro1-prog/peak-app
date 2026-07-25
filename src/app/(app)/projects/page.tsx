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

  return (
    <ProjectsView
      projects={data.projects}
      pending={data.pending}
      sel={null}
      filter={filter}
      tab="overview"
      custById={data.custById}
      identity={data.identity}
      roster={data.roster}
    />
  );
}

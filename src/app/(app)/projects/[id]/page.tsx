import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { ProjectsView } from "../view";
import { loadProjectsData, one, normFilter } from "../data";

export const metadata = { title: "Project — Quartzite-6" };

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, { id }, sp, data] = await Promise.all([
    requireUser(),
    params,
    searchParams,
    loadProjectsData(),
  ]);

  const sel = data.projects.find((p) => p.id === id);
  if (!sel) notFound();

  const filter = normFilter(one(sp.filter));
  const tab = one(sp.tab) || "overview";

  return (
    <ProjectsView
      projects={data.projects}
      pending={data.pending}
      sel={sel}
      filter={filter}
      tab={tab}
      custById={data.custById}
      identity={data.identity}
      roster={data.roster}
    />
  );
}

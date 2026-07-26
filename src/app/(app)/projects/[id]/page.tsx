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
  const [user, { id }, sp, data] = await Promise.all([
    requireUser(),
    params,
    searchParams,
    loadProjectsData(),
  ]);

  const sel = data.projects.find((p) => p.id === id);
  if (!sel) notFound();

  const filter = normFilter(one(sp.filter));
  const tab = one(sp.tab) || "overview";
  // #19: list (default, stripped from URLs) | board — allowlisted like the
  // leads view param.
  const view = one(sp.view) === "board" ? ("board" as const) : ("list" as const);
  // #22 — see projects/page.tsx; sel resolves UNSCOPED on purpose.
  const whoRaw = one(sp.who);
  const who = !whoRaw || whoRaw === "all" ? "" : whoRaw === "mine" || whoRaw === user.name ? "mine" : whoRaw;
  const ownerName = who === "mine" ? user.name : who;
  const projects = ownerName ? data.projects.filter((p) => p.owner === ownerName) : data.projects;
  const pending = ownerName ? data.pending.filter((q) => (q.owner || "") === ownerName) : data.pending;

  return (
    <ProjectsView
      projects={projects}
      pending={pending}
      sel={sel}
      filter={filter}
      tab={tab}
      view={view}
      who={who}
      meName={user.name}
      custById={data.custById}
      identity={data.identity}
      roster={data.roster}
      taskRows={data.taskRows}
      people={data.people}
    />
  );
}

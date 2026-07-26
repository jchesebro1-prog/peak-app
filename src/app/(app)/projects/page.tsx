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
  const [user, sp, data] = await Promise.all([requireUser(), searchParams, loadProjectsData()]);
  // Legacy/cross-screen deep links use /projects?id=<id>; the detail lives at
  // /projects/[id]. Redirect so both link shapes resolve to the detail view.
  const idParam = one(sp.id);
  if (idParam) redirect(`/projects/${encodeURIComponent(idParam)}`);
  const filter = normFilter(one(sp.filter));
  // #19: list (default, stripped from URLs) | board — allowlisted like the
  // leads view param.
  const view = one(sp.view) === "board" ? ("board" as const) : ("list" as const);
  // #22 — the quotes ?who= idiom; STRICT owner match applied to the full
  // book BEFORE ProjectsView (stats, counts, list and board all derive from
  // the scoped array). The won-ready strip scopes too — someone else's won
  // quotes don't belong under "My projects".
  const whoRaw = one(sp.who);
  const who = !whoRaw || whoRaw === "all" ? "" : whoRaw === "mine" || whoRaw === user.name ? "mine" : whoRaw;
  const ownerName = who === "mine" ? user.name : who;
  const projects = ownerName ? data.projects.filter((p) => p.owner === ownerName) : data.projects;
  const pending = ownerName ? data.pending.filter((q) => (q.owner || "") === ownerName) : data.pending;

  return (
    <ProjectsView
      projects={projects}
      pending={pending}
      sel={null}
      filter={filter}
      tab="overview"
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

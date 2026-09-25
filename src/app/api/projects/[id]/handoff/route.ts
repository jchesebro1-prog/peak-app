import { requireUser } from "@/lib/session";
import { getProject, signoffScopes, VENDORS, fmtDateY } from "@/lib/stores/projects";
import { tasksForProject } from "@/lib/stores/tasks";
import { getSettings } from "@/lib/settings";
import { renderLetterPdf, type FieldSheetDoc } from "@/lib/pdf";

/** Printable installer handoff packet (#44). The on-screen packet remains the
 * interactive source; this route creates a customer/crew-safe field sheet
 * without exposing raw project JSON or signature bytes in the response. */
export async function GET(
  _req: Request,
  context: { params: Promise<unknown> },
): Promise<Response> {
  await requireUser();
  const { id } = (await context.params) as { id: string };
  const project = await getProject(decodeURIComponent(id));
  if (!project) return new Response("Project not found", { status: 404 });

  const [settings, tasks] = await Promise.all([getSettings(), tasksForProject(project.id)]);
  const groups = new Map<string, typeof project.procurement>();
  for (const line of project.procurement || []) {
    const scope = VENDORS[line.vendor]?.scope || line.vendor || "General installation";
    const rows = groups.get(scope) || [];
    rows.push(line);
    groups.set(scope, rows);
  }
  const projectTasks = tasks.filter((task) => task.projectId === project.id);
  const done = projectTasks.filter((task) => task.status === "done").length;
  const liveNotes = (project.notes || []).filter((n) => !n.deleted);
  const crew = project.crew?.length
    ? project.crew.map((member) => `${member.person} (${member.role || "crew"})`).join(", ")
    : "Unassigned";

  const sections: FieldSheetDoc["pages"][number]["sections"] = [
    {
      heading: "Site & schedule",
      rows: [
        { label: "Customer", value: project.customer || "—" },
        { label: "Project", value: project.name || project.id },
        { label: "Stage", value: project.stageMeta?.label ?? project.stage },
        { label: "Install window", value: project.installStart ? `${fmtDateY(project.installStart)} – ${fmtDateY(project.installEnd)}` : "Not scheduled" },
        { label: "Target date", value: fmtDateY(project.targetDate) },
        { label: "Crew", value: crew },
      ],
    },
    ...Array.from(groups.entries()).map(([scope, lines]) => ({
      heading: `Materials — ${scope}`,
      rows: lines.map((line) => ({
        label: `${line.qty} ${line.unit} · ${line.sku}`,
        value: `${line.desc} · ${line.status}`,
      })),
    })),
    {
      heading: "Field progress",
      rows: [
        { label: "Tasks", value: `${done} of ${projectTasks.length} complete` },
        { label: "Notes", value: `${liveNotes.length} recorded` },
        { label: "Customer acceptance", value: project.signoff ? `Signed by ${project.signoff.name || "customer"} · ${fmtDateY(project.signoff.signedAt)}` : "Pending" },
        { label: "Linked design package", value: project.quoteId ? `Available from linked quote ${project.quoteId}` : "No linked quote" },
      ],
    },
    ...(liveNotes.length
      ? [{
          heading: "Recent notes",
          rows: liveNotes.slice(0, 12).map((note) => ({ label: `${note.by} · ${fmtDateY(note.at)}`, value: note.text })),
        }]
      : []),
    {
      heading: "Drawings & datasheets",
      rows: [
        { label: "Handoff", value: "Use the linked Grid client package for plan sheets, riser, specifications, and catalog datasheets." },
        { label: "Scope checklist", value: signoffScopes(project).join(", ") || "No purchased scopes recorded" },
      ],
    },
  ];

  const sheet: FieldSheetDoc = {
    job: project.id,
    date: fmtDateY(Date.now()),
    footer: "Installer handoff packet · Verify field conditions and received materials before work begins.",
    pages: [{ title: "Installer Handoff Packet", sections }],
  };
  const pdf = renderLetterPdf({
    companyName: settings.companyName || "Peak Systems Group",
    accent: settings.accent || "#7b3f8a",
    tag: "Installer Handoff",
    meta: [],
    re: project.name,
    greeting: "Crew",
    blocks: [],
    costLine: "",
    costTail: "",
    taxNote: "",
    signer: { name: "", title: "" },
    fieldSheet: sheet,
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${project.id}-handoff.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}

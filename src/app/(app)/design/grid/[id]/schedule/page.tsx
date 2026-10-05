import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getProject } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { getSettings } from "@/lib/settings";
import { resolveOptionId } from "@/lib/design/grid-options";
import { loadDeviceTypeContext } from "@/lib/stores/device-types";
import { scheduleForOption } from "@/lib/design/grid-schedule-server";
import { PrintButton } from "@/components/letter/print-button";
import ScheduleTable from "./schedule-table";

export const metadata = { title: "Equipment schedule — Quartzite-6" };
export const dynamic = "force-dynamic";
// Virtual parts (#211) reach listFixtures() on this page — same budget as the editor.
export const maxDuration = 60;

/**
 * Per-space equipment schedule (D113 item 3) — the field document: what
 * hangs in which room, plus the wire runs (routes and typed riser links,
 * #209) between rooms. Deliberately NO prices. Built by the same
 * buildSchedule the drawing set's E-60x sheets use, so the two never differ.
 */
export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ option?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const { option: requestedOption } = await searchParams;
  const project = await getProject(decodeURIComponent(id));
  if (!project) {
    return (
      <div style={{ padding: 24, fontSize: 13.5 }}>
        <p style={{ marginBottom: 10 }}>That design no longer exists.</p>
        <Link href="/design/designs" style={{ color: "#3155a8" }}>← Back to The Grid</Link>
      </div>
    );
  }

  const optionId = resolveOptionId(project, requestedOption);
  const option = project.options!.find((o) => o.id === optionId)!;
  const optionQuery = `?option=${encodeURIComponent(optionId)}`;

  const [catalog, gridSymbols, settings] = await Promise.all([listCatalog(), listGridSymbols(), getSettings()]);
  // #226: device types — the scope fix (Unscoped, not the old Lighting fallback).
  const deviceTypes = await loadDeviceTypeContext(catalog);
  const accent = settings.accent || "#b08d4a";
  // #299: the editor's Spreadsheet view builds the same schedule through the same helper.
  const schedule = await scheduleForOption(project, optionId, { catalog, gridSymbols, settings, deviceTypes });

  return (
    <div className="pk-content" style={{ padding: "26px 30px 64px" }}>
      <div className="pk-doc-toolbar">
        <Link
          href={`/design/grid/${encodeURIComponent(project.id)}${optionQuery}`}
          style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", marginRight: "auto", textDecoration: "none" }}
        >
          ← {project.name}
        </Link>
        <PrintButton accent={accent} />
      </div>

      <div className="pk-doc-page">
        <div style={{ borderBottom: `3px solid ${accent}`, paddingBottom: 10, marginBottom: 18 }}>
          <div style={{ fontFamily: "var(--font-mono), monospace", fontSize: "8pt", letterSpacing: ".14em", textTransform: "uppercase", color: "#666" }}>
            {settings.companyName || "Peak Systems Group"} · Equipment schedule
          </div>
          <div style={{ fontSize: "17pt", fontWeight: 700, marginTop: 2 }}>{project.name}{project.options!.length > 1 ? ` · ${option.name}` : ""}</div>
          <div style={{ fontSize: "11pt", color: "#444", marginTop: 1 }}>
            {project.customer || "—"}
            {" · "}
            {new Date(project.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
            {" · "}
            {(project.sheetIds || []).length} sheet{(project.sheetIds || []).length === 1 ? "" : "s"} · {project.id}
          </div>
        </div>

        <ScheduleTable schedule={schedule} accent={accent} />
      </div>
    </div>
  );
}

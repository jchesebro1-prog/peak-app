import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getProject } from "@/lib/stores/grid-projects";
import { getDesign } from "@/lib/stores/studio-designs";
import { DEFAULT_LINESET_INPUTS, generateLineset, type LinesetInputs } from "@/lib/design/lineset";

export const metadata = { title: "Lineset schedule — Quartzite-6" };

function inputsOf(data: unknown): LinesetInputs {
  const raw = data && typeof data === "object" ? (data as { inputs?: unknown }).inputs : undefined;
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : data as Record<string, unknown>;
  const out = { ...DEFAULT_LINESET_INPUTS };
  if (!source || typeof source !== "object") return out;
  for (const key of Object.keys(DEFAULT_LINESET_INPUTS) as (keyof LinesetInputs)[]) {
    const value = source[key];
    if (value !== undefined && typeof value === typeof out[key]) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

export default async function GridLinesetSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const project = await getProject(decodeURIComponent(id));
  if (!project) return <div className="pk-content"><p>That design no longer exists.</p></div>;
  const design = project.linesetDesignId ? await getDesign(project.linesetDesignId) : null;
  if (!design || design.kind !== "lineset") {
    return (
      <div className="pk-content" style={{ maxWidth: 900 }}>
        <Link href={`/design/grid/${encodeURIComponent(project.id)}`} style={{ color: "#3155a8" }}>← Back to The Grid</Link>
        <h1 style={{ fontSize: 22, marginTop: 14 }}>Lineset schedule</h1>
        <p style={{ color: "#6b7079", marginTop: 8 }}>Link a saved Lineset Builder design from the Grid toolbar to generate this schedule.</p>
      </div>
    );
  }
  const result = generateLineset(inputsOf(design.data));
  return (
    <div className="pk-content" style={{ maxWidth: 1000 }}>
      <Link href={`/design/grid/${encodeURIComponent(project.id)}`} style={{ color: "#3155a8" }}>← Back to The Grid</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, marginTop: 14 }}>
        <div>
          <h1 style={{ fontSize: 22 }}>Lineset schedule</h1>
          <p style={{ color: "#6b7079", marginTop: 4 }}>{project.name} · {design.name}</p>
        </div>
        <Link href={`/design/lineset?design=${encodeURIComponent(design.id)}`} style={{ color: "#3155a8", fontSize: 13 }}>Edit in Lineset Builder →</Link>
      </div>
      <div className="pk-card" style={{ marginTop: 16, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>{["Line", "Type", "Distance from PL", "Goods", "Notes"].map((h) => <th key={h} style={{ textAlign: "left", padding: "9px 10px", borderBottom: "1px solid #e6e8ed", fontSize: 11, color: "#777" }}>{h}</th>)}</tr></thead>
          <tbody>{result.schedule.map((line) => <tr key={`${line.slot}-${line.type}`}>
            <td style={{ padding: "9px 10px", borderBottom: "1px solid #f0f1f4" }}>{line.slot}</td>
            <td style={{ padding: "9px 10px", borderBottom: "1px solid #f0f1f4" }}>{line.type || "—"}</td>
            <td style={{ padding: "9px 10px", borderBottom: "1px solid #f0f1f4" }}>{line.dsPositionLabel} / {line.usPositionLabel}</td>
            <td style={{ padding: "9px 10px", borderBottom: "1px solid #f0f1f4" }}>{line.name || "—"}</td>
            <td style={{ padding: "9px 10px", borderBottom: "1px solid #f0f1f4", color: "#6b7079" }}>{line.warning || line.rule || ""}</td>
          </tr>)}</tbody>
        </table>
        {!result.schedule.length && <p style={{ padding: 14, color: "#6b7079" }}>No active linesets in the linked design.</p>}
      </div>
    </div>
  );
}

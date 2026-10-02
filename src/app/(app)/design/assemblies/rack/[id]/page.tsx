import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/letter/print-button";
import { RackSheets } from "@/components/rack/RackSheets";
import { RACK_PREVIEW_CSS } from "@/components/rack/rack-sheet-css";
import { loadRackForSheets } from "@/lib/rack/load";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rack submittal — Quartzite-6" };

const LINK = { fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--accent)", textDecoration: "none" } as const;

/** #296 — a rack's submittal sheets (elevation, schedule, power/heat) for staff: preview, print, download. */
export default async function RackSubmittalPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const [data, settings] = await Promise.all([loadRackForSheets(id), getSettings()]);
  if (!data) notFound();
  const accent = settings.accent || "#b08d4a";
  const enc = encodeURIComponent(data.rec.id);
  return (
    <div className="pk-content" style={{ maxWidth: "none", padding: "22px 24px 64px" }}>
      <style>{RACK_PREVIEW_CSS}</style>
      <div className="pk-doc-toolbar pk-no-print" style={{ maxWidth: "none", justifyContent: "flex-start", flexWrap: "wrap", gap: 14 }}>
        <Link href="/design/assemblies" style={LINK}>← Back to assemblies</Link>
        <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-ui)" }}>{`Rack submittal — ${data.rec.label}`}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 14, alignItems: "center" }}>
          <a href={`/api/racks/${enc}/submittal`} style={LINK}>Download submittal (.zip)</a>
          <a href={`/api/racks/${enc}/submittal?part=csv`} style={LINK}>Schedule (.csv)</a>
          <PrintButton accent={accent} />
        </span>
      </div>
      <RackSheets sheet="all" data={data} />
    </div>
  );
}

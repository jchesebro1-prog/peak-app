import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getEngagement } from "@/lib/stores/engagements";
import MarkupViewer from "./viewer";

export const metadata = { title: "Markup — Peak Backend" };
export const dynamic = "force-dynamic";

/**
 * Document markup (D95) — /consulting/markup?eng=CE-1001&phase=ph-x&doc=ed-y
 * Its own full-width route rather than a panel: marking up a drawing needs
 * the whole screen.
 */
export default async function MarkupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";

  const engId = one(sp.eng);
  const phaseId = one(sp.phase);
  const eng = engId ? await getEngagement(engId) : null;
  const phase = eng?.phases.find((p) => p.id === phaseId) || null;

  if (!eng || !phase) {
    return (
      <div style={{ padding: 24, fontSize: 13.5 }}>
        <p style={{ marginBottom: 10 }}>That phase no longer exists.</p>
        <Link href="/consulting" style={{ color: "#3155a8" }}>
          ← Back to Consulting
        </Link>
      </div>
    );
  }

  const docs = phase.attachments.map((a) => ({
    id: a.id,
    name: a.name,
    mime: a.mime,
    dataUrl: a.dataUrl,
  }));
  const activeDocId = one(sp.doc) || docs[0]?.id || "";

  return (
    <MarkupViewer
      engagementId={eng.id}
      engagementName={eng.name}
      phaseId={phase.id}
      phaseName={phase.name}
      docs={docs}
      activeDocId={activeDocId}
      annotations={phase.annotations || []}
      calibrations={phase.calibrations || []}
      comments={(phase.comments || []).map((c) => ({
        id: c.id,
        body: c.body,
        author: c.author,
        state: c.state,
      }))}
    />
  );
}

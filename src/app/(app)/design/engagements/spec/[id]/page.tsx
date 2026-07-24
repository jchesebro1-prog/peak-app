import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getGeneratedSpec } from "@/lib/stores/generated-specs";
import { renderSpecHtml } from "@/lib/bid-spec";
import SpecDocView from "./doc-view";

export const metadata = { title: "Specification — Quartzite" };
export const dynamic = "force-dynamic";

/** A saved bid spec (D94) — frozen output, print view + Word download. */
export default async function GeneratedSpecPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const rec = await getGeneratedSpec(id);

  if (!rec) {
    return (
      <div style={{ padding: 24, fontSize: 13.5 }}>
        <p style={{ marginBottom: 10 }}>That specification no longer exists.</p>
        <Link href="/design/engagements" style={{ color: "#3155a8" }}>
          ← Back to Consulting
        </Link>
      </div>
    );
  }

  return (
    <SpecDocView
      specId={rec.id}
      engagementId={rec.engagementId}
      projectName={rec.spec.projectName}
      createdBy={rec.createdBy}
      createdAt={rec.createdAt}
      sectionCount={rec.spec.sections.length}
      waived={rec.spec.waived}
      html={renderSpecHtml(rec.spec)}
      filename={`${rec.spec.projectName.replace(/[^a-z0-9]+/gi, "-")}-specification`}
    />
  );
}

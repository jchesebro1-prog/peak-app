import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getEngagement } from "@/lib/stores/engagements";
import { allSections } from "@/lib/stores/spec-sections";
import { specsForEngagement } from "@/lib/stores/generated-specs";
import { getAll as getAllQuotes } from "@/lib/stores/quotes";
import SpecGenerator from "./generator";

export const metadata = { title: "Bid Specification — Quartzite" };
export const dynamic = "force-dynamic";

/**
 * Bid-spec generator (D94) — /design/engagements/spec?id=<engagementId>.
 * Own route rather than an engagement tab, matching /design/engagements/letter:
 * it is a multi-step working screen, not a panel.
 */
export default async function SpecPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const sp = await searchParams;
  const id = Array.isArray(sp.id) ? sp.id[0] : sp.id;

  const eng = id ? await getEngagement(id) : null;
  if (!eng) {
    return (
      <div style={{ padding: 24, fontSize: 13.5 }}>
        <p style={{ marginBottom: 10 }}>No engagement selected.</p>
        <Link href="/design/engagements" style={{ color: "#3155a8" }}>
          ← Back to Consulting
        </Link>
      </div>
    );
  }

  const [sections, saved, quotes] = await Promise.all([
    allSections(),
    specsForEngagement(eng.id),
    getAllQuotes(),
  ]);

  // Quotes worth offering as a BOM source: this engagement's own consulting
  // quote rarely carries equipment, but its linked install quote does.
  const sourceQuotes = quotes
    .filter(
      (q) =>
        q.id === eng.installQuoteId ||
        q.id === eng.quoteId ||
        (eng.companyId && q.customerId === eng.companyId)
    )
    .map((q) => ({ id: q.id, name: q.name, customer: q.customer, value: q.value }));

  return (
    <SpecGenerator
      engagement={{ id: eng.id, name: eng.name, customer: eng.customer }}
      sections={sections.map((s) => ({ id: s.id, number: s.number, title: s.title }))}
      sourceQuotes={sourceQuotes}
      saved={saved.map((s) => ({
        id: s.id,
        source: s.source,
        createdAt: s.createdAt,
        createdBy: s.createdBy,
        sectionCount: s.spec.sections.length,
        waivedCount: s.waivedCount,
      }))}
    />
  );
}

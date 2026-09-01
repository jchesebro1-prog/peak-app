import Link from "next/link";
import { requireUser } from "@/lib/session";
import { allEngagements, getEngagement } from "@/lib/stores/engagements";
import { ENGAGEMENT_STATUS_LABEL } from "@/lib/consulting-stages";
import { allSections } from "@/lib/stores/spec-sections";
import { specsForEngagement } from "@/lib/stores/generated-specs";
import { getAll as getAllQuotes } from "@/lib/stores/quotes";
import SpecGenerator from "./generator";

export const metadata = { title: "Bid Specification — Quartzite-6" };
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

  if (!id) {
    const engagements = await allEngagements();
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "26px 22px 60px", fontFamily: "var(--font-ui)" }}>
        <div style={{ marginBottom: 22 }}>
          <h1 style={{ margin: 0, fontSize: 23, letterSpacing: -0.4 }}>Spec Builder</h1>
          <p style={{ margin: "6px 0 0", color: "#5b616e", fontSize: 13.5, lineHeight: 1.5 }}>
            Choose a consulting engagement to assemble a bid specification from its linked estimate or Grid BOM.
          </p>
        </div>

        {engagements.length === 0 ? (
          <div className="pk-card" style={{ padding: 22, fontSize: 13.5 }}>
            <div style={{ fontWeight: 700, marginBottom: 5 }}>No consulting engagements yet</div>
            <div style={{ color: "#5b616e", marginBottom: 12 }}>
              Start a consulting engagement first, then return here to build its specification package.
            </div>
            <Link href="/design/engagements" style={{ color: "var(--accent)", fontWeight: 650 }}>
              Open Consulting →
            </Link>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {engagements.map((item) => (
              <Link
                key={item.id}
                href={`/design/engagements/spec?id=${encodeURIComponent(item.id)}`}
                className="pk-card"
                style={{ display: "block", padding: "15px 16px", color: "inherit", textDecoration: "none" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "var(--font-mono)" }}>{item.id}</div>
                    <div style={{ marginTop: 3, fontSize: 14.5, fontWeight: 700 }}>{item.name}</div>
                    <div style={{ marginTop: 2, color: "#5b616e", fontSize: 12.5 }}>{item.customer}</div>
                  </div>
                  <div style={{ color: "var(--accent)", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                    Build spec →
                  </div>
                </div>
                <div style={{ marginTop: 10, fontSize: 11.5, color: "#6b7280" }}>
                  {ENGAGEMENT_STATUS_LABEL[item.status]} · {item.designIds.length} linked design{item.designIds.length === 1 ? "" : "s"}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  const eng = await getEngagement(id);
  if (!eng) {
    return (
      <div style={{ padding: 24, fontSize: 13.5 }}>
        <p style={{ marginBottom: 10 }}>That consulting engagement could not be found.</p>
        <Link href="/design/engagements/spec" style={{ color: "var(--accent)" }}>
          ← Choose an engagement
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

import Link from "next/link";
import { requireUser } from "@/lib/session";
import { allSections } from "@/lib/stores/spec-sections";
import { getEngagement } from "@/lib/stores/engagements";
import { get as getQuote } from "@/lib/stores/quotes";
import { getProject } from "@/lib/stores/grid-projects";
import { specCustomerOptions } from "../customer-options";
import NewSpecForm, { type NewSpecSource } from "./new-spec-form";

/**
 * #205 Phase B (T5) — New spec. Pick a section (required), optionally a
 * customer and the project name/number, then the builder opens.
 *
 *   /design/specs/new                               from scratch
 *   /design/specs/new?quote=<id>                    Spec from this quote
 *   /design/specs/new?grid=<projectId>&quote=<id>   Spec from this Grid design
 *   /design/specs/new?engagement=<id>               the old engagement door:
 *     its install quote, else its quote, else from scratch
 *
 * A source that doesn't resolve (unknown quote/engagement, a Grid design with
 * no quote) says so and falls back to from scratch rather than failing the
 * create.
 */

export const metadata = { title: "New spec — Quartzite-6" };

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] ?? "" : v ?? "").trim();
}

const SECTION_PICK_NOTE = "only parts that belong to the section you pick are added.";

export default async function NewSpecPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [, sp, sections, customerOptions] = await Promise.all([requireUser(), searchParams, allSections(), specCustomerOptions()]);
  const quoteParam = one(sp.quote);
  const gridParam = one(sp.grid);
  const engagementParam = one(sp.engagement);

  let quoteId = "";
  let fromLabel = "";
  let notice = "";
  let defaultCustomerId = "";
  let defaultProjectName = "";
  let gridProjectId = "";

  if (engagementParam) {
    const e = await getEngagement(engagementParam);
    if (!e) {
      notice = `Engagement ${engagementParam} was not found — this spec starts from scratch.`;
    } else {
      defaultCustomerId = e.companyId || "";
      defaultProjectName = e.name;
      quoteId = e.installQuoteId || e.quoteId || "";
      if (quoteId) fromLabel = e.name;
      else notice = `${e.name} has no quote yet — this spec starts from scratch.`;
    }
  } else if (gridParam) {
    const g = await getProject(gridParam);
    if (!g) {
      notice = `Grid design ${gridParam} was not found — this spec starts from scratch.`;
    } else if (!quoteParam) {
      notice = `${g.name} has no quote yet — add it to Quotes first, or this spec starts from scratch.`;
    } else {
      gridProjectId = g.id;
      quoteId = quoteParam;
      fromLabel = `Grid design ${g.name}`;
      defaultCustomerId = g.customerId || "";
    }
  } else if (quoteParam) {
    quoteId = quoteParam;
  }

  let source: NewSpecSource | null = null;
  let summary = "";
  if (quoteId) {
    const q = await getQuote(quoteId);
    if (!q) {
      notice = `Quote ${quoteId} was not found — this spec starts from scratch.`;
    } else {
      source = gridProjectId ? { kind: "grid", gridProjectId, quoteId: q.id } : { kind: "quote", quoteId: q.id };
      defaultCustomerId = defaultCustomerId || q.customerId || "";
      summary = fromLabel
        ? `From ${fromLabel} (quote ${q.id}) — ${SECTION_PICK_NOTE}`
        : `From quote ${q.id} — ${SECTION_PICK_NOTE}`;
    }
  }
  // A default the typeahead can't show would only fail the create
  // ("Customer not found."), so drop it.
  if (defaultCustomerId && !customerOptions.some((o) => o.id === defaultCustomerId)) defaultCustomerId = "";

  const sectionOptions = [...sections]
    .sort((a, b) => a.sort - b.sort || a.number.localeCompare(b.number))
    .map((s) => ({ id: s.id, number: s.number, title: s.title }));

  return (
    <div className="pk-content" style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 18 }}>
        <Link href="/design/specs" style={{ fontSize: 12, color: "#8c919c", textDecoration: "none" }}>
          ← Specs
        </Link>
        <div className="pk-page-title" style={{ marginTop: 6 }}>
          New spec
        </div>
        <div className="pk-page-sub">Pick the CSI section this Word file covers. You can fill in the rest next.</div>
      </div>

      {sectionOptions.length === 0 ? (
        <div className="pk-card" style={{ padding: 20, fontSize: 13, color: "#3a3f4a" }}>
          The library has no sections yet — import or add one in the Spec library first.{" "}
          <Link href="/design/specs/library" style={{ color: "var(--accent)", fontWeight: 600 }}>
            Open the Spec library →
          </Link>
        </div>
      ) : (
        <NewSpecForm
          sections={sectionOptions}
          customerOptions={customerOptions}
          source={source}
          summary={summary}
          notice={notice}
          defaultCustomerId={defaultCustomerId}
          defaultProjectName={defaultProjectName}
        />
      )}
    </div>
  );
}

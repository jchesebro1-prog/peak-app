import { matchBom, assemble, renderSpecHtml, report, type MatchedRow } from "@/lib/bid-spec";
import { parseCsv } from "@/app/(app)/consulting/spec/parse-bom";
import { approvalIsStale, openChecklistItems } from "@/lib/consulting-review";
import type { EngagementPhase } from "@/lib/stores/engagements";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };

/* --- BOM parsing --- */
const p = parseCsv("sku,description,qty\nS4LED,Source Four LED,12\n,Mystery fixture,3\nJUNK");
ok(p.ok, "parses CSV with header aliases");
if (p.ok) ok(p.rows.length === 3, `keeps all usable rows (got ${p.rows.length})`);
const bad = parseCsv("just one line");
ok(!bad.ok, "rejects a single-line paste");

/* --- matching --- */
const catalog = [
  { id: "S4LED", sku: "S4LED", desc: "ETC Source Four LED Series 2", category: "Lighting", unit: "ea", list: 1200, cost: 800, specSectionId: "ss-light", specBody: "Provide LED ellipsoidal.\n\nColor rendering index 90 minimum." },
  { id: "CYC1", sku: "CYC1", desc: "Cyclorama fixture 4-cell", category: "Lighting", unit: "ea", list: 900, cost: 600 },
] as any[];

const rep = matchBom(
  [ { sku: "S4LED", desc: "Source Four LED", qty: 12 },
    { sku: "CYC1", desc: "Cyc light", qty: 4 },
    { sku: "NOPE", desc: "ETC Source Four LED Series 2", qty: 1 } ],
  catalog
);
ok(rep.counts.ready === 1, `exact SKU with spec text -> ready (${rep.counts.ready})`);
ok(rep.counts["no-spec"] === 1, `exact SKU without spec text -> no-spec (${rep.counts["no-spec"]})`);
ok(rep.counts["no-match"] === 1, `unknown SKU -> no-match (${rep.counts["no-match"]})`);
ok(rep.rows[2].candidates.length > 0, "unmatched row gets similarity candidates");
ok(rep.rows[2].part === null, "candidates are SUGGESTED, never auto-assigned");
ok(!rep.finalizable, "cannot finalize while rows are unresolved");

const waived = rep.rows.map((r, i) => i === 0 ? r : { ...r, waived: true, waiveReason: "n/a" });
ok(report(waived).finalizable, "finalizable once every row is ready or waived");

/* --- assembly --- */
const spec = assemble(
  rep.rows.map((r, i) => i === 1 ? { ...r, waived: true, waiveReason: "owner-furnished" } : r) as MatchedRow[],
  [{ id: "ss-light", number: "26 55 61", title: "Theatrical Lighting Fixtures", sort: 40, part1: "Scope of work.", part3: "Install per manufacturer.", updatedAt: 0, updatedBy: "t" }],
  { projectName: "Test PAC", customer: "Test District", engagementId: "CE-1001", preparedBy: "Jeff", date: Date.now() }
);
ok(spec.sections.length === 1, "assembles one section from the ready row");
ok(spec.sections[0].parts.length === 1, "only ready rows contribute Part 2 text");
ok(spec.waived.length === 1, "waived rows are recorded, not rendered as specs");

const html = renderSpecHtml(spec);
ok(html.includes("SECTION 26 55 61"), "renders the CSI section heading");
ok(html.includes("PART 1 — GENERAL") && html.includes("PART 2 — PRODUCTS") && html.includes("PART 3 — EXECUTION"), "renders all three CSI parts");
ok(html.includes("2.01"), "numbers products automatically");
ok(html.includes("ITEMS NOT SPECIFIED"), "documents the deliberate omission");
ok(!html.includes("<script"), "no script injection in output");

/* --- approval staleness --- */
const phase = (docs: any[], pin: any): EngagementPhase => ({ id: "ph-1", name: "Final Documents", status: "active", review: {} as any, attachments: docs, checklist: [{ id: "ck1", text: "x", state: "open", by: null, at: null, reason: "" }], approvalPin: pin });
const d1 = { id: "ed-1", name: "A.pdf", mime: "application/pdf", size: 10, dataUrl: "", addedBy: "j", addedAt: 100 };
const pin = { at: 1, by: "Jack", snapshotId: "rs-1", docs: [{ docId: "ed-1", name: "A.pdf", size: 10, version: 100 }] };
ok(!approvalIsStale(phase([d1], pin)), "approval is fresh when documents are unchanged");
ok(approvalIsStale(phase([{ ...d1, id: "ed-2", addedAt: 200 }], pin)), "approval goes stale when a document is replaced");
ok(approvalIsStale(phase([], pin)), "approval goes stale when a document is removed");
ok(openChecklistItems(phase([d1], pin)).length === 1, "open checklist items are detected");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED");
process.exit(fail ? 1 : 0);

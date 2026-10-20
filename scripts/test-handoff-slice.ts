/**
 * handoff:slice checks — the allow-listed data cut for the Estimator handoff prototype
 * (plan docs/superpowers/plans/…estimator-handoff-pr2*, Task 1). Runs against
 * docs/estimating-core/handoff-fixtures/export-v2.json (golden quotes + customer
 * tables + planted secrets). test:specs → handoffSliceChecks(ok).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CATALOG_FIELDS, QUOTE_FIELDS, BLOB_IDS, SETTINGS_FIELDS, COMPANY_COLS, SITE_COLS, CONTACT_COLS,
  pickFields, scanForSecrets, selectEstimates, catalogChunks,
} from "../handoff/estimator/slice-rules";
import { sliceExport, writeSlice, type ExportV2 } from "../handoff/estimator/slice";
import type { Ok } from "./test-inbox-org";

export const FIXTURE_V2 = "docs/estimating-core/handoff-fixtures/export-v2.json";
const GOLDEN_V1 = "docs/estimating-core/golden-fixtures/export.json";

const SECRETS = ["1//0abcdEFGHijkl-SECRET", "sk-ant-api03-SECRET", "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];

export async function handoffSliceChecks(ok: Ok) {
  const exp = JSON.parse(fs.readFileSync(FIXTURE_V2, "utf8")) as ExportV2;
  ok(exp.meta?.format === 2, "handoff:slice: the fixture is a format-2 export");

  // --- pure rules ---
  const rows = (exp.collections?.quotes ?? []) as Array<{ id: string; doc: Record<string, unknown>; deleted?: boolean }>;
  ok(selectEstimates(rows).map((q) => q.id).join(",") === "Q-G001,Q-G002,Q-G003",
    "handoff:slice: selectEstimates keeps live non-Daylite system quotes with lines (Q-G001..3)");
  ok(rows.some((r) => (r.doc.source as string) === "daylite"), "handoff:slice: the fixture carries a Daylite quote to exclude");
  const sel = selectEstimates(rows);
  ok(sel.every((q) => !("shareLink" in q) && !("leadId" in q) && !("bid" in q) && !("packageFiles" in q) && !("shareOpens" in q)),
    "handoff:slice: excluded quote fields (shareLink, leadId, bid, packageFiles…) never survive");
  ok(!QUOTE_FIELDS.some((f) => /^portal/.test(f)) && !(QUOTE_FIELDS as readonly string[]).includes("leadId"), "handoff:slice: QUOTE_FIELDS has no portal* / leadId");
  const pf = pickFields({ a: 1, b: 2, c: undefined }, ["a", "c", "z"]);
  ok(JSON.stringify(pf) === '{"a":1}', "handoff:slice: pickFields copies only present allow-listed keys");
  ok(CATALOG_FIELDS.includes("sku") && BLOB_IDS.includes("pricing_rules") && SETTINGS_FIELDS.includes("companyName") &&
    COMPANY_COLS.includes("name") && SITE_COLS.includes("companyId") && CONTACT_COLS.includes("homeCompanyId"), "handoff:slice: allow-list constants exported");

  ok(scanForSecrets("sk-ant-api03-SECRET").includes("sk-ant"), "handoff:slice: scanForSecrets flags sk-ant-api03-SECRET");
  const rulesHit = (s: string) => scanForSecrets(s).length > 0;
  ok(rulesHit("sk-" + "A".repeat(24)) && rulesHit("ghp_" + "a".repeat(36)) && rulesHit("1//0abcdEFGHijkl-SECRET") && rulesHit("ya29.a0Abc") &&
    rulesHit("xoxb-123") && rulesHit("-----BEGIN RSA PRIVATE KEY-----") && rulesHit("vercel_blob_rw_abc") && rulesHit("AKIA" + "A1".repeat(8)),
    "handoff:slice: every secret rule fires on a sample");
  ok(!rulesHit("Meyer Sound LEOPARD 2x4 loudspeaker — cost 1,200 (task list)"), "handoff:slice: ordinary catalog text is clean");

  const mk = (n: number) => ({ id: `P${n}`, sku: `P${n}`, desc: "x".repeat(40) });
  const three = [mk(1), mk(2), mk(3)];
  const empty = catalogChunks([], 1e9)[0].length;
  const one = catalogChunks([mk(1)], 1e9)[0].length;
  const small = empty + 2 * (one - empty) + 2; // two parts plus the ",\n" between them
  const chunks = catalogChunks(three, small);
  ok(chunks.length === 2 && chunks.every((c) => Buffer.byteLength(c) <= small), `handoff:slice: catalogChunks splits 3 parts into 2 files, each ≤ maxBytes (${chunks.length} files)`);
  ok(chunks.every((c) => /^\(window\.PEAK_CATALOG = window\.PEAK_CATALOG \|\| \[\]\)\.push\(/.test(c)), "handoff:slice: catalog chunk is the push-into-PEAK_CATALOG script");
  ok(catalogChunks(three, 1e9).length === 1, "handoff:slice: a generous maxBytes keeps one file");

  // --- the slice ---
  const r = sliceExport(exp);
  ok(r.hits.length === 0, "handoff:slice: the fixture slice passes the final secret scan" + (r.hits.length ? ` — ${JSON.stringify(r.hits)}` : ""));
  const names = Object.keys(r.files).sort();
  ok(["data/meta.js", "data/rules.js", "data/catalog-1.js", "data/fixtures.js", "data/estimates.js", "data/customers.js", "data/team.js", "data/photo-manifest.json"].every((n) => names.includes(n)),
    `handoff:slice: all contract files emitted (${names.join(", ")})`);
  ok(names.filter((n) => n.endsWith(".js")).every((n) => /^\(window\.PEAK_|^window\.PEAK_/.test(r.files[n])), "handoff:slice: every .js file starts with (window.PEAK_ / window.PEAK_");
  ok(names.every((n) => Buffer.byteLength(r.files[n]) <= 15_000_000), "handoff:slice: every emitted file ≤ 15,000,000 bytes");

  const load = (n: string) => {
    const w: Record<string, unknown> = {};
    new Function("window", r.files[n])(w);
    return w;
  };
  const est = load("data/estimates.js").PEAK_ESTIMATES as Array<{ id: string }>;
  ok(est.map((q) => q.id).join(",") === "Q-G001,Q-G002,Q-G003", "handoff:slice: estimates.js carries Q-G001..3");
  const cust = load("data/customers.js").PEAK_CUSTOMERS as Record<string, Array<Record<string, unknown>>>;
  ok(cust.companies.map((c) => c.id).sort().join(",") === "c-alpha,c-beta", "handoff:slice: only referenced companies are kept");
  ok(cust.sites.length > 0 && cust.sites.every((s) => s.companyId === "c-alpha" || s.companyId === "c-beta"), "handoff:slice: sites belong to referenced companies only");
  ok(cust.contacts.length > 0 && cust.contacts.every((c) => c.homeCompanyId === "c-alpha" || c.homeCompanyId === "c-beta"), "handoff:slice: contacts at referenced companies only");
  const cids = new Set(cust.contacts.map((c) => c.id));
  ok(cust.contactEmails.every((e) => cids.has(e.contactId)) && cust.contactPhones.every((p) => cids.has(p.contactId)), "handoff:slice: contact emails/phones follow kept contacts");
  ok(cust.companies.every((c) => !("ownerUserId" in c) && !("custom" in c)), "handoff:slice: company columns are allow-listed");
  ok(cust.geoCache.length === 1, "handoff:slice: geoCache keeps only rows whose key involves a kept site");

  const team = load("data/team.js").PEAK_TEAM as Array<Record<string, unknown>>;
  ok(team.length === 2 && team.every((u) => u.status === "active" && !("email" in u) && !("googleEmail" in u) && !("phone" in u)), "handoff:slice: team = active users, no emails or phones");

  const rules = load("data/rules.js").PEAK_RULES as { settings: Record<string, unknown>; blobs: Record<string, unknown> };
  ok(Object.keys(rules.blobs).join(",") === "pricing_rules" && !("assist_secrets" in rules.blobs) && !("portal_departments" in rules.blobs), "handoff:slice: only allow-listed blobs reach rules.js");
  ok(rules.settings.companyName === "Peak Systems Group" && !("assistUsers" in rules.settings) && !("mailboxes" in rules.settings), "handoff:slice: settings are picked to the allow-list");

  const catalog = (load("data/catalog-1.js").PEAK_CATALOG ?? []) as Array<Record<string, unknown>>;
  ok(catalog.map((p) => p.sku).sort().join(",") === "SKU-A,SKU-B" && catalog.every((p) => !("portalHidden" in p)), "handoff:slice: catalog = live parts, allow-listed fields only");
  const partA = catalog.find((p) => p.sku === "SKU-A");
  ok(partA?.note === "", "handoff:slice: scrub — a secret-shaped catalog note is replaced with \"\"");
  ok((est.find((q) => q.id === "Q-G001") as Record<string, unknown> | undefined)?.quoteNote === "" &&
    (est.find((q) => q.id === "Q-G002") as Record<string, unknown>).assumptions === "", "handoff:slice: scrub — quoteNote / assumptions with secrets become \"\"");
  const rep = r.scrubbed;
  ok(rep.some((e) => e.field === "note" && e.id === "SKU-A" && e.file === "data/catalog-1.js" && e.rule === "github-token") &&
    rep.some((e) => e.field === "quoteNote" && e.id === "Q-G001" && e.file === "data/estimates.js") &&
    rep.some((e) => e.field === "assumptions" && e.id === "Q-G002"), "handoff:slice: the report lists { file, id, field, rule } per scrub");

  const fixtures = load("data/fixtures.js").PEAK_FIXTURES as Array<{ id: string }>;
  ok(fixtures.length === 1 && fixtures[0].id === "fa-1", "handoff:slice: fixtures.js carries live subassemblies");
  const manifest = JSON.parse(r.files["data/photo-manifest.json"]) as Array<Record<string, unknown>>;
  ok(manifest.length === 1 && manifest[0].sku === "SKU-A" && manifest[0].docId === "PD-1" && manifest[0].blobKey === "part-docs/PD-1/a.webp" && "sourceUrl" in manifest[0],
    "handoff:slice: photo-manifest lists visible image links { sku, docId, blobKey, sourceUrl }");
  const meta = load("data/meta.js").PEAK_META as { sliceVersion: number; counts: Record<string, number> };
  ok(meta.sliceVersion === 1 && meta.counts.estimates === 3 && meta.counts.catalog === 2 && meta.counts.companies === 2, "handoff:slice: meta.js carries sliceVersion 1 and counts");

  const all = Object.values(r.files).join("\n");
  ok(SECRETS.every((s) => !all.includes(s)), "handoff:slice: no planted secret appears in any emitted file");
  ok(!all.includes("refreshToken") && !all.includes("gmailConnections") && !all.includes("assist_secrets") && !all.includes("sk-ant"), "handoff:slice: nothing from gmailConnections or the assist_secrets blob");
  ok(!all.includes("daylite") && !all.includes("Q-G004") && !all.includes("c-gamma"), "handoff:slice: Daylite quote, deleted quote and unreferenced company stay out");
  ok(!/@/.test(r.files["data/team.js"]), "handoff:slice: team.js contains no email address");

  // backstop: a secret in allow-listed (non-scrubbed) data stops the slice, nothing is written
  const bad = JSON.parse(JSON.stringify(exp)) as ExportV2;
  bad.blobs!.find((b) => b.id === "pricing_rules")!.data = { note: "sk-ant-api03-SECRET" };
  const rb = sliceExport(bad);
  ok(rb.hits.length > 0 && rb.hits.some((h) => h.file === "data/rules.js" && h.rules.includes("sk-ant")), "handoff:slice: backstop — a secret in a kept blob is caught in the final scan");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-slice-"));
  try {
    const outBad = path.join(tmp, "bad");
    ok(writeSlice(rb, outBad) === false && !fs.existsSync(outBad), "handoff:slice: writeSlice refuses (writes nothing) when the scan is not clean");
    const outGood = path.join(tmp, "good", "data");
    ok(writeSlice(r, outGood) === true && fs.existsSync(path.join(outGood, "estimates.js")) && fs.existsSync(path.join(outGood, "photo-manifest.json")), "handoff:slice: writeSlice writes the clean slice (paths relative to the out dir)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --extra-estimates: dev slices can carry the golden quotes (an alternate, bonus lines)
  const golden = JSON.parse(fs.readFileSync(GOLDEN_V1, "utf8")) as ExportV2;
  const base = { ...exp, collections: { ...exp.collections, quotes: [] } } as ExportV2;
  const none = sliceExport(base);
  const withExtra = sliceExport(base, { extraEstimates: selectEstimates((golden.collections?.quotes ?? []) as never) });
  const ids = (res: typeof r) => ((): string[] => { const w: Record<string, unknown> = {}; new Function("window", res.files["data/estimates.js"])(w); return (w.PEAK_ESTIMATES as Array<{ id: string }>).map((q) => q.id); })();
  ok(ids(none).length === 0 && ids(withExtra).join(",") === "Q-G001,Q-G002,Q-G003", "handoff:slice: --extra-estimates appends another export's selected estimates");
}

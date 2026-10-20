/**
 * handoff:slice checks — the allow-listed data cut for the Estimator handoff prototype
 * (plan docs/superpowers/plans/…estimator-handoff-pr2*, Task 1). Runs against
 * docs/estimating-core/handoff-fixtures/export-v2.json (golden quotes + customer
 * tables + planted secrets). test:specs → handoffSliceChecks(ok).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import {
  CATALOG_FIELDS, FIXTURE_FIELDS, QUOTE_FIELDS, BLOB_IDS, SETTINGS_FIELDS, COMPANY_COLS, SITE_COLS, CONTACT_COLS,
  pickFields, scanForSecrets, selectEstimates, catalogChunks,
} from "../handoff/estimator/slice-rules";
import { sliceExport, writeSlice, type ExportV2 } from "../handoff/estimator/slice";
import type { Ok } from "./test-inbox-org";

export const FIXTURE_V2 = "docs/estimating-core/handoff-fixtures/export-v2.json";
const GOLDEN_V1 = "docs/estimating-core/golden-fixtures/export.json";

// Token-shaped test values are assembled here, never written literally in the repo (the committed fixture holds
// @@SECRET_*@@ placeholders that load() swaps for these).
const T = {
  ant: "sk-" + "ant-api03-SECRET",
  googleRefresh: "1/" + "/0abcdEFGHijkl-SECRET",
  googleAccess: "ya29" + ".fake",
  github: "gh" + "p_" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
};
const SECRETS = [T.googleRefresh, T.ant, T.github];
const PLACEHOLDERS: Record<string, string> = {
  "@@SECRET_ANT@@": T.ant,
  "@@SECRET_GOOGLE_REFRESH@@": T.googleRefresh,
  "@@SECRET_GOOGLE_ACCESS@@": T.googleAccess,
  "@@SECRET_GITHUB@@": T.github,
};
function loadFixture(): ExportV2 {
  let raw = fs.readFileSync(FIXTURE_V2, "utf8");
  for (const [k, v] of Object.entries(PLACEHOLDERS)) raw = raw.split(k).join(v);
  return JSON.parse(raw) as ExportV2;
}

export async function handoffSliceChecks(ok: Ok) {
  const exp = loadFixture();
  ok(exp.meta?.format === 2, "handoff:slice: the fixture is a format-2 export");
  ok(scanForSecrets(fs.readFileSync(FIXTURE_V2, "utf8")).length === 0,
    "handoff:slice: the committed fixture holds no token-shaped string (placeholders only)");

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

  ok(scanForSecrets(T.ant).includes("sk-ant"), "handoff:slice: scanForSecrets flags an sk-ant key");
  const rulesHit = (s: string) => scanForSecrets(s).length > 0;
  ok(rulesHit("sk-" + "A".repeat(24)) && rulesHit("gh" + "p_" + "a".repeat(36)) && rulesHit(T.googleRefresh) && rulesHit("ya29" + ".a0Abc") &&
    rulesHit("xox" + "b-123") && rulesHit("-----BEGIN RSA PRIVATE KEY-----") && rulesHit("vercel_blob" + "_rw_abc") && rulesHit("AKIA" + "A1".repeat(8)),
    "handoff:slice: every secret rule fires on a sample");
  // the widened and added rules, one positive each
  const ruleOf = (str: string, name: string) => scanForSecrets(str).includes(name);
  ok(ruleOf("sk-" + "proj_" + "a1B2-c3D4_".repeat(3), "sk-key"), "handoff:slice: rule sk-key fires on an sk-proj_… style key (underscore/dash)");
  ok(ruleOf("github" + "_pat_" + "A1b2C3d4E5".repeat(3), "github-pat"), "handoff:slice: rule github-pat fires");
  ok(ruleOf("gh" + "o_" + "A1b2C3d4E5".repeat(4), "github-oauth-token") && ruleOf("gh" + "s_" + "A1b2C3d4E5".repeat(4), "github-oauth-token") &&
    ruleOf("gh" + "u_" + "A1b2C3d4E5".repeat(4), "github-oauth-token"), "handoff:slice: rule github-oauth-token fires on gho_/ghs_/ghu_");
  ok(ruleOf("AI" + "za" + "SyA-1234567890abcdefghijklmnopqrstu", "google-api-key"), "handoff:slice: rule google-api-key fires");
  ok(ruleOf("ey" + "JhbGciOiJIUzI1NiJ9." + "ey" + "JzdWIiOiIxMjM0NTY3ODkwIn0.sig", "jwt"), "handoff:slice: rule jwt fires");
  ok(ruleOf("Authorization: Bear" + "er abcDEF0123456789.abcDEF0123456789", "bearer-token"), "handoff:slice: rule bearer-token fires");
  // a key directly after a JSON escape (the final scan runs on JSON.stringify output)
  const skKey = "sk-" + "proj_" + "a1B2-c3D4_".repeat(3);
  ok(ruleOf(JSON.stringify("line one\n" + skKey), "sk-key"), "handoff:slice: sk-key fires after a JSON \\n escape");
  ok(ruleOf(JSON.stringify("col\t" + skKey), "sk-key"), "handoff:slice: sk-key fires after a JSON \\t escape");
  ok(scanForSecrets(JSON.stringify("line one\n" + skKey)).length > 0 && scanForSecrets(JSON.stringify("col\t" + skKey)).length > 0,
    "handoff:slice: scanForSecrets is non-empty for an sk-proj_ key after \\n and \\t");
  // a Bearer token carrying the base64 / URL-safe characters
  ok(ruleOf("Authorization: Bear" + "er " + "aB+/=cD".repeat(4), "bearer-token"), "handoff:slice: bearer-token fires on a token containing + / =");
  ok(ruleOf("postgres" + "://neon_user:p4ssw0rd@ep-cool.neon.tech/db", "postgres-credentials") && ruleOf("postgresql" + "://u:p@h/db", "postgres-credentials"),
    "handoff:slice: rule postgres-credentials fires on a URL with credentials");
  ok(!rulesHit("postgres://localhost:5432/peak") && !rulesHit("risk-based-assessment-plan-for-the-venue") && !rulesHit("Bearer token required"),
    "handoff:slice: negative control — host-only postgres URL, 'risk-based-…' prose and a short 'Bearer' phrase are clean");
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
  const geoKeys = (cust.geoCache as unknown as Array<{ key: string }>).map((g) => g.key).sort();
  ok(geoKeys.join(" ") === "43.0000,-89.0000|43.0731,-89.4012 43.1000,-89.5000|43.2000,-89.3000",
    `handoff:slice: geoCache keeps a row only when BOTH halves are a kept site or an office (${geoKeys.join(" ")})`);
  ok(!geoKeys.includes("43.0731,-89.4012|44.0000,-88.0000"), "handoff:slice: geoCache drops a kept site paired with an UNREFERENCED company's site");
  ok(geoKeys.includes("43.0000,-89.0000|43.0731,-89.4012"), "handoff:slice: geoCache keeps a kept site paired with the office");
  ok(!cust.sites.some((x) => x.id === "st-c-alpha-9") && cust.sites.some((x) => x.id === "st-c-alpha-2"),
    "handoff:slice: sites — every live site of a referenced company is emitted (venue picker), the deleted st-c-alpha-9 is not");
  ok(!cust.contacts.some((c) => c.id === "ct-4") && cust.contacts.some((c) => c.id === "ct-1"), "handoff:slice: the deleted contact ct-4 is excluded");

  const team = load("data/team.js").PEAK_TEAM as Array<Record<string, unknown>>;
  ok(team.length === 2 && team.every((u) => u.status === "active" && !("email" in u) && !("googleEmail" in u) && !("phone" in u)), "handoff:slice: team = active users, no emails or phones");

  const rules = load("data/rules.js").PEAK_RULES as { settings: Record<string, unknown>; blobs: Record<string, unknown> };
  ok(Object.keys(rules.blobs).join(",") === "pricing_rules" && !("assist_secrets" in rules.blobs) && !("portal_departments" in rules.blobs), "handoff:slice: only allow-listed blobs reach rules.js");
  ok(rules.settings.companyName === "Peak Systems Group" && !("assistUsers" in rules.settings) && !("mailboxes" in rules.settings), "handoff:slice: settings are picked to the allow-list");

  const catalog = (load("data/catalog-1.js").PEAK_CATALOG ?? []) as Array<Record<string, unknown>>;
  ok(catalog.map((p) => p.sku).sort().join(",") === "SKU-A,SKU-B" && catalog.every((p) => !("portalHidden" in p)), "handoff:slice: catalog = live parts, allow-listed fields only");
  ok(SITE_COLS.includes("createdAt") && cust.sites.every((x) => typeof x.createdAt === "number"),
    "handoff:slice: sites carry createdAt (the venue order's tie-break)");
  // a part retired by a SKU rename rides along as a { id, sku, renamedTo } stub; a plain delete (SKU-C) stays out
  const withRetired = JSON.parse(JSON.stringify(exp)) as ExportV2;
  withRetired.collections!.catalog_parts.push({ id: "OLD-SKU", deleted: true, doc: { sku: "OLD-SKU", desc: "Retired part", cost: 99, renamedTo: "SKU-A" } } as never);
  const rr = sliceExport(withRetired);
  const loadR = (n: string) => { const w: Record<string, unknown> = {}; new Function("window", rr.files[n])(w); return w; };
  const catR = (loadR("data/catalog-1.js").PEAK_CATALOG ?? []) as Array<Record<string, unknown>>;
  const stub = catR.find((x) => x.id === "OLD-SKU");
  ok(JSON.stringify(stub) === JSON.stringify({ id: "OLD-SKU", sku: "OLD-SKU", renamedTo: "SKU-A" }), `handoff:slice: a retired part is emitted as { id, sku, renamedTo } only (got ${JSON.stringify(stub)})`);
  ok(catR.map((x) => x.id).sort().join(",") === "OLD-SKU,SKU-A,SKU-B" && !catR.some((x) => x.id === "SKU-C"), "handoff:slice: a deleted part without renamedTo stays out of the catalog");
  const metaR = loadR("data/meta.js").PEAK_META as { counts: Record<string, number> };
  ok(metaR.counts.catalog === 2 && metaR.counts.catalogRetired === 1 && rr.hits.length === 0, "handoff:slice: meta counts live parts and retired stubs apart");
  // the stored default quote pipeline reaches the prototype (Settings → Pipelines' defaultQuotePipelineId)
  ok(SETTINGS_FIELDS.includes("defaultQuotePipelineId" as never), "handoff:slice: SETTINGS_FIELDS carries defaultQuotePipelineId");
  const withDefault = JSON.parse(JSON.stringify(exp)) as ExportV2;
  (withDefault.appSettings!.find((a) => a.id === "main")!.data as Record<string, unknown>).defaultQuotePipelineId = "bid-spec";
  const wd = sliceExport(withDefault);
  const wdw: Record<string, unknown> = {};
  new Function("window", wd.files["data/rules.js"])(wdw);
  ok((wdw.PEAK_RULES as { settings: Record<string, unknown> }).settings.defaultQuotePipelineId === "bid-spec", "handoff:slice: settings.defaultQuotePipelineId reaches rules.js");
  const partA = catalog.find((p) => p.sku === "SKU-A");
  ok(partA?.note === "", "handoff:slice: scrub — a secret-shaped catalog note is replaced with \"\"");
  ok((est.find((q) => q.id === "Q-G001") as Record<string, unknown> | undefined)?.quoteNote === "" &&
    (est.find((q) => q.id === "Q-G002") as Record<string, unknown>).assumptions === "", "handoff:slice: scrub — quoteNote / assumptions with secrets become \"\"");
  const estBody = r.files["data/estimates.js"];
  ok(!estBody.includes("clientResponses") && !estBody.includes("bonusRecord") && !estBody.includes("estimatorBonusSplit") && !estBody.includes("respondent@example.org"),
    "handoff:slice: estimates.js carries no clientResponses / bonusRecord / estimatorBonusSplit (data minimization)");
  ok(!(QUOTE_FIELDS as readonly string[]).some((f) => ["clientResponses", "bonusRecord", "estimatorBonusSplit"].includes(f)),
    "handoff:slice: QUOTE_FIELDS excludes clientResponses, bonusRecord, estimatorBonusSplit");
  const rep = r.scrubbed;
  ok(rep.some((e) => e.field === "note" && e.id === "SKU-A" && e.file === "data/catalog-1.js" && e.rule === "github-token") &&
    rep.some((e) => e.field === "quoteNote" && e.id === "Q-G001" && e.file === "data/estimates.js") &&
    rep.some((e) => e.field === "assumptions" && e.id === "Q-G002"), "handoff:slice: the report lists { file, id, field, rule } per scrub");

  const fixtures = load("data/fixtures.js").PEAK_FIXTURES as Array<{ id: string }>;
  ok(fixtures.length === 1 && fixtures[0].id === "fa-1", "handoff:slice: fixtures.js carries live subassemblies");
  const fx = fixtures[0] as Record<string, unknown>;
  ok(!("internalNote" in fx) && fx.createdBy === "u1" && fx.kind === "fixture" && Array.isArray(fx.lines) && FIXTURE_FIELDS.includes("lines"),
    "handoff:slice: fixtures are picked to FIXTURE_FIELDS — an unknown field is dropped, FixtureRecord fields kept");
  const manifest = JSON.parse(r.files["data/photo-manifest.json"]) as Array<Record<string, unknown>>;
  ok(manifest.length === 1 && manifest[0].sku === "SKU-A" && manifest[0].docId === "PD-1" && manifest[0].blobKey === "part-docs/PD-1/a.webp" && "sourceUrl" in manifest[0],
    "handoff:slice: photo-manifest lists visible image links { sku, docId, blobKey, sourceUrl }");
  ok(manifest[0].sourceUrl === "https://example.com/a.webp" && !r.files["data/photo-manifest.json"].includes("token=") && !r.files["data/photo-manifest.json"].includes("#frag"),
    "handoff:slice: photo-manifest sourceUrl drops the query string and fragment (scheme + host + path only)");
  const meta = load("data/meta.js").PEAK_META as { sliceVersion: number; counts: Record<string, number> };
  ok(meta.sliceVersion === 1 && meta.counts.estimates === 3 && meta.counts.catalog === 2 && meta.counts.companies === 2, "handoff:slice: meta.js carries sliceVersion 1 and counts");

  const all = Object.values(r.files).join("\n");
  ok(SECRETS.every((s) => !all.includes(s)), "handoff:slice: no planted secret appears in any emitted file");
  ok(!all.includes("refreshToken") && !all.includes("gmailConnections") && !all.includes("assist_secrets") && !all.includes("sk-ant"), "handoff:slice: nothing from gmailConnections or the assist_secrets blob");
  ok(!all.includes("daylite") && !all.includes("Q-G004") && !all.includes("c-gamma"), "handoff:slice: Daylite quote, deleted quote and unreferenced company stay out");
  ok(!/@/.test(r.files["data/team.js"]), "handoff:slice: team.js contains no email address");

  // backstop: a secret in allow-listed (non-scrubbed) data stops the slice, nothing is written
  const bad = JSON.parse(JSON.stringify(exp)) as ExportV2;
  bad.blobs!.find((b) => b.id === "pricing_rules")!.data = { note: T.ant };
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

  // --- CLI exit codes (child process, real entry point) ---
  const repo = process.cwd();
  const runCli = (args: string[]) => spawnSync("npx", ["tsx", "handoff/estimator/slice.ts", ...args], { cwd: repo, encoding: "utf8", timeout: 120_000 });
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-slice-cli-"));
  try {
    const v1 = JSON.parse(JSON.stringify(exp)) as ExportV2;
    v1.meta = { ...v1.meta, format: 1 };
    const v1Path = path.join(tmp2, "v1.json");
    fs.writeFileSync(v1Path, JSON.stringify(v1));
    const out1 = path.join(tmp2, "out-v1");
    const c1 = runCli(["--in", v1Path, "--out", out1]);
    ok(c1.status === 2 && !fs.existsSync(out1), `handoff:slice: CLI — a format-1 export exits 2 and writes nothing (exit ${c1.status})`);

    const dirty = JSON.parse(JSON.stringify(exp)) as ExportV2;
    (dirty.appSettings!.find((a) => a.id === "main")!.data as Record<string, unknown>).companyName = "Peak " + T.github;
    const dirtyPath = path.join(tmp2, "dirty.json");
    fs.writeFileSync(dirtyPath, JSON.stringify(dirty));
    const out2 = path.join(tmp2, "out-dirty");
    const c2 = runCli(["--in", dirtyPath, "--out", out2]);
    ok(c2.status === 1 && !fs.existsSync(out2) && /SECRET SCAN/.test(c2.stderr), `handoff:slice: CLI — a secret in an un-scrubbed place (settings) exits 1 and writes nothing (exit ${c2.status})`);

    const cleanPath = path.join(tmp2, "clean.json");
    fs.writeFileSync(cleanPath, JSON.stringify(exp));
    const out3 = path.join(tmp2, "out-clean");
    const c3 = runCli(["--in", cleanPath, "--out", out3]);
    ok(c3.status === 0 && fs.existsSync(path.join(out3, "estimates.js")), `handoff:slice: CLI — a clean format-2 export exits 0 and writes the slice (exit ${c3.status})`);
  } finally {
    fs.rmSync(tmp2, { recursive: true, force: true });
  }
}

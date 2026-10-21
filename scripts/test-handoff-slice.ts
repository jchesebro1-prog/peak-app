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
import ts from "typescript";
import {
  CATALOG_FIELDS, FIXTURE_FIELDS, QUOTE_FIELDS, BLOB_IDS, SETTINGS_FIELDS, COMPANY_COLS, SITE_COLS, CONTACT_COLS,
  REVISION_FIELDS, DOC_FIELDS, VENDOR_QUOTE_FIELDS, EXCLUDED_SOURCES, DEFAULT_RECENT_DAYS, ESTIMATOR_SOURCES, SelectionError,
  pickFields, scanForSecrets, selectEstimates, catalogChunks, sanitizeQuote, parseRecentDays, recentWindow, selectBundledEstimates,
  selectCatalogScope, quoteStamp, noEstimatesMessage, describeEstimateSelection,
} from "../handoff/estimator/slice-rules";
import { sliceExport, writeSlice, loadPhotoManifest, run as sliceRun, type ExportV2 } from "../handoff/estimator/slice";
import { downloadPlan, manufacturerImageIds, parsePhotoManifest, photoScopeSkus, photosScript, selectPhotos } from "../handoff/estimator/photo-select";
import { AUTH_ABORT_MESSAGE, BlobAuthError, blobKeyBelongsTo, buildPhotoManifest, completeImageExt, describeSelection, downloadPhotos, DEFAULT_OUTPUT_ROOT, main as photosMain, photosOutProblem, reconcileImagesDir, estimatesForExport, selectionForExport, sniffImageExt, type BlobClient } from "../handoff/estimator/fetch-photos";
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
  ok(selectBundledEstimates(rows as never, exp.meta?.exportedAt).estimates.map((q) => q.id).join(",") === "Q-G001,Q-G002,Q-G003",
    "handoff:slice: the fixture's Q-G001..3 all fall in the default 28-day window (Q-G002 by its createdAt) and the Daylite quote does not");
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
  ok(["data/meta.js", "data/rules.js", "data/catalog-1.js", "data/fixtures.js", "data/estimates.js", "data/customers.js", "data/team.js"].every((n) => names.includes(n)),
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
  const activeTeam = team.filter((u) => u.status === "active");
  const inactiveTeam = team.filter((u) => u.status !== "active");
  ok(team.length === 3 && activeTeam.length === 2 && !team.some((u) => "email" in u || "googleEmail" in u || "phone" in u),
    "handoff:slice: team = every user, no emails or phones");
  ok(inactiveTeam.length === 1 && inactiveTeam.every((u) => Object.keys(u).sort().join() === "id,name,roles,status"),
    `handoff:slice: an inactive user rides along as { id, name, roles, status } only (got ${JSON.stringify(inactiveTeam)})`);

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
  ok(!("data/photo-manifest.json" in r.files) && Object.values(r.files).every((b) => !b.includes("part-docs/")),
    "handoff:slice: the private photo selection is not part of the slice — no data/photo-manifest.json, no file names a Blob pathname (part-docs/…)");
  ok(!("data/photos.js" in r.files), "handoff:slice: no data/photos.js without an images/manifest.json (placeholders only)");
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
    ok(writeSlice(r, outGood) === true && fs.existsSync(path.join(outGood, "estimates.js")) && !fs.existsSync(path.join(outGood, "photo-manifest.json")), "handoff:slice: writeSlice writes the clean slice (paths relative to the out dir), without a photo-manifest.json");
    fs.writeFileSync(path.join(outGood, "photo-manifest.json"), "[]");
    ok(writeSlice(r, outGood) === true && !fs.existsSync(path.join(outGood, "photo-manifest.json")), "handoff:slice: a photo-manifest.json left by an earlier slicer is removed on re-slice");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --extra-estimates: dev slices can carry the golden quotes (an alternate, bonus lines)
  const golden = JSON.parse(fs.readFileSync(GOLDEN_V1, "utf8")) as ExportV2;
  const base = { ...exp, collections: { ...exp.collections, quotes: [] } } as ExportV2;
  let noneErr: unknown = null;
  try { sliceExport(base); } catch (e) { noneErr = e; }
  ok(noneErr instanceof SelectionError && noneErr.code === "no-estimates", "handoff:slice: an export with no qualifying estimate and no extras is refused (SelectionError no-estimates)");
  const withExtra = sliceExport(base, { extraEstimates: selectEstimates((golden.collections?.quotes ?? []) as never) });
  const ids = (res: typeof r) => ((): string[] => { const w: Record<string, unknown> = {}; new Function("window", res.files["data/estimates.js"])(w); return (w.PEAK_ESTIMATES as Array<{ id: string }>).map((q) => q.id); })();
  ok(ids(withExtra).join(",") === "Q-G001,Q-G002,Q-G003", "handoff:slice: --extra-estimates appends another export's selected estimates (outside the window — the golden quotes carry no stamp)");

  // --- final review A1–A4: revisions / vendor quotes allow-listed, portal-catalog excluded, boltWidthIn kept ---
  await revisionAllowListChecks(ok, exp);

  // --- Jeff Oct 20: the recent Estimator estimates + only the catalog they (and every assembly) need ---
  await recentSelectionChecks(ok, exp);

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

  await photoChecks(ok, exp);
}

// ---------------------------------------------------------------------------------------------------------------
// Task 11 — product photos: the selection (the app's own rule), the download (fake Blob client), the CLI.

const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x08, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const mkRow = (id: string, doc: Record<string, unknown>, deleted = false) => ({ id, doc, deleted });

async function quiet<T>(fn: () => Promise<T>): Promise<{ value: T; out: string; err: string }> {
  const log = console.log, error = console.error, warn = console.warn;
  let out = "", err = "";
  console.log = (...a: unknown[]) => { out += a.join(" ") + "\n"; };
  console.error = (...a: unknown[]) => { err += a.join(" ") + "\n"; };
  console.warn = (...a: unknown[]) => { err += a.join(" ") + "\n"; };
  try {
    return { value: await fn(), out, err };
  } finally {
    console.log = log;
    console.error = error;
    console.warn = warn;
  }
}

async function photoChecks(ok: Ok, exp: ExportV2) {
  // --- selection on the export-v2 fixture: PD-4 (listed first, sort 1) loses to PD-1 (sort 0); L2/PD-2 is hidden; L3 is a datasheet ---
  const sel = selectionForExport(exp);
  ok(sel.scopeSkus.includes("SKU-A") && sel.scopeSkus.includes("SKU-B") && sel.scopeSkus.includes("ETC:CS15") && sel.scopeSkus.includes("Symetrix:Jupiter 4"),
    `handoff:photos: scope = the skus the sliced estimates (Q-G001..3) and the fixture name (${sel.scopeSkus.length})`);
  ok(!sel.scopeSkus.includes("X") && !sel.scopeSkus.includes("SKU-C"), "handoff:photos: scope leaves out a Daylite/deleted/flame-test quote's skus and unreferenced parts");
  const pick = (res: typeof sel, sku: string) => res.picks.find((p) => p.sku === sku);
  ok(pick(sel, "SKU-A")?.docId === "PD-1" && pick(sel, "SKU-A")?.via === "own", "handoff:photos: selection — the higher-ranked image wins (PD-1 sort 0 over PD-4 sort 1, though PD-4 comes first in the file)");
  ok(sel.picks.every((p) => p.docId !== "PD-2" && p.docId !== "PD-3"), "handoff:photos: selection — a hidden image link (PD-2) and a datasheet link (PD-3) are never picked");
  ok(pick(sel, "SKU-B")?.docId === "PD-5" && pick(sel, "SKU-B")?.via === "manufacturer", "handoff:photos: selection — a part with no image of its own gets its manufacturer's image (Beta → PD-5)");
  ok(sel.withoutPhoto.includes("ETC:CS15") && !sel.withoutPhoto.includes("SKU-A"), "handoff:photos: selection — an in-scope part with no photo is listed as withoutPhoto");
  ok(pick(sel, "SKU-A")?.sourceUrl === "https://example.com/a.webp", "handoff:photos: selection — sourceUrl is scheme + host + path only");

  const variant = (edit: (e: ExportV2) => void): ReturnType<typeof selectPhotos> => {
    const e = clone(exp);
    edit(e);
    return selectionForExport(e);
  };
  const links = (e: ExportV2) => e.collections!.part_document_links as Array<{ id: string; doc: Record<string, unknown> }>;
  const docs = (e: ExportV2) => e.collections!.part_documents as Array<{ id: string; doc: Record<string, unknown>; deleted?: boolean }>;
  const flip = variant((e) => { links(e).find((l) => l.id === "L1")!.doc.sort = 5; });
  ok(pick(flip, "SKU-A")?.docId === "PD-4", "handoff:photos: selection — re-ordering the links (explicit sort) changes the primary");
  const unhidden = variant((e) => { delete links(e).find((l) => l.id === "L2")!.doc.hidden; });
  ok(pick(unhidden, "SKU-A")?.docId === "PD-1", "handoff:photos: selection — an un-hidden link without a sort ranks after the sorted ones");
  const bySource = variant((e) => {
    for (const l of links(e)) delete l.doc.sort;
    delete links(e).find((l) => l.id === "L2")!.doc.hidden;
    docs(e).find((d) => d.id === "PD-1")!.doc.source = "fetch";
    docs(e).find((d) => d.id === "PD-2")!.doc.source = "upload";
  });
  ok(["PD-2", "PD-4"].includes(pick(bySource, "SKU-A")!.docId) && pick(bySource, "SKU-A")!.docId !== "PD-1", "handoff:photos: selection — with no explicit sort an upload outranks a fetched image (IMAGE_SOURCE_RANK)");
  const render = variant((e) => {
    docs(e).find((d) => d.id === "PD-1")!.doc.source = "datasheet-render";
    links(e).find((l) => l.id === "L1")!.doc.sort = 0;
  });
  ok(pick(render, "SKU-A")?.docId === "PD-4", "handoff:photos: selection — a datasheet-render thumbnail sorts after every real image whatever its sort");
  const noMfr = variant((e) => { (e.collections!.manufacturers as Array<{ id: string }>).splice(1, 1); });
  ok(!pick(noMfr, "SKU-B") && noMfr.withoutPhoto.includes("SKU-B"), "handoff:photos: selection — no manufacturer record → no photo");
  const ownBeatsMfr = variant((e) => {
    (e.collections!.manufacturers as Array<{ doc: Record<string, unknown> }>)[0].doc.imageDocumentId = "PD-5";
  });
  ok(pick(ownBeatsMfr, "SKU-A")?.docId === "PD-1" && pick(ownBeatsMfr, "SKU-A")?.via === "own", "handoff:photos: selection — a manufacturer image never replaces a part's own photo");
  const merged = variant((e) => {
    const parts = e.collections!.catalog_parts as Array<{ id: string; doc: Record<string, unknown> }>;
    parts.find((p) => p.id === "SKU-B")!.doc.mfr = "Beta Lighting";
    (e.collections!.manufacturers as unknown[]).push(mkRow("MF-betalighting", { id: "MF-betalighting", key: "betalighting", mergedInto: "beta" }));
    (e.collections!.manufacturers as Array<{ id: string; doc: Record<string, unknown> }>).find((m) => m.id === "MF-beta")!.doc.aliasKeys = ["betalighting"];
  });
  ok(pick(merged, "SKU-B")?.docId === "PD-5", "handoff:photos: selection — a merged-away manufacturer spelling resolves to its target's image (canonicalKeyMap)");
  const lookup = manufacturerImageIds([{ key: "a", imageDocumentId: "PD-9", mergedInto: "b" }, { key: "b", imageDocumentId: "PD-8", aliasKeys: ["a"] }]);
  ok(lookup("A") === "PD-8" && lookup("zzz") === null, "handoff:photos: manufacturerImageIds — a merged-away record never supplies an image; lookup is mfrKey-normalized");
  const badMfrDoc = variant((e) => { docs(e).find((d) => d.id === "PD-5")!.doc.kind = "datasheet"; });
  ok(!pick(badMfrDoc, "SKU-B"), "handoff:photos: selection — a manufacturer 'image' that is not an image document is ignored");
  const deletedDoc = variant((e) => { docs(e).find((d) => d.id === "PD-1")!.deleted = true; });
  ok(pick(deletedDoc, "SKU-A")?.docId === "PD-4", "handoff:photos: selection — a deleted document is skipped (the next-ranked image is the primary)");
  const outOfScope = variant((e) => {
    (e.collections!.catalog_parts as unknown[]).push(mkRow("SKU-X", { sku: "SKU-X", desc: "unused", mfr: "Beta" }));
    links(e).push({ id: "LX", doc: { id: "LX", partSku: "SKU-X", documentId: "PD-4", kind: "image" } });
  });
  ok(!pick(outOfScope, "SKU-X") && !outOfScope.scopeSkus.includes("SKU-X"), "handoff:photos: selection — a part no sliced estimate or fixture names gets no photo");
  const linkOnly = variant((e) => {
    docs(e).push(mkRow("PD-8", { id: "PD-8", kind: "image", blobKey: null, sourceUrl: "https://cdn.example.com/p.jpg?sig=zzz#x", source: "fetch" }) as never);
    docs(e).push(mkRow("PD-9", { id: "PD-9", kind: "image", blobKey: null, sourceUrl: null, source: "fetch" }) as never);
    links(e).push({ id: "L8", doc: { id: "L8", partSku: "SKU-B", documentId: "PD-8", kind: "image" } });
    links(e).push({ id: "L9", doc: { id: "L9", partSku: "SKU-B", documentId: "PD-9", kind: "image", sort: -1 } });
  });
  ok(pick(linkOnly, "SKU-B")?.docId === "PD-8" && pick(linkOnly, "SKU-B")?.blobKey === null && pick(linkOnly, "SKU-B")?.sourceUrl === "https://cdn.example.com/p.jpg",
    "handoff:photos: selection — a link-only document can be the primary (kept, sourceUrl cleaned); a document with neither file nor link is dead and skipped");
  const plan = downloadPlan(linkOnly.picks);
  ok(plan.download.map((d) => d.docId).join(",") === "PD-1" && plan.linkOnly.map((l) => `${l.sku}:${l.docId}`).join(",") === "SKU-B:PD-8",
    "handoff:photos: downloadPlan — link-only picks are recorded, not downloaded; one entry per document");
  const renamed = variant((e) => {
    (e.collections!.catalog_parts as unknown[]).push(mkRow("OLD-A", { sku: "OLD-A", renamedTo: "SKU-A" }, true));
    (e.collections!.subassemblies as Array<{ id: string; doc: Record<string, unknown> }>).find((f) => f.id === "fa-1")!.doc.lines = [{ sku: "OLD-A", qty: 1 }];
  });
  ok(renamed.scopeSkus.includes("SKU-A") && !renamed.scopeSkus.includes("OLD-A") && pick(renamed, "SKU-A")?.docId === "PD-1", "handoff:photos: selection — a retired SKU on a fixture follows its rename to the part that carries the photos");
  ok(photoScopeSkus([{ spec: { sections: [{ items: [{ sku: "A", components: [{ sku: "B" }] }] }] } }], [{ lightEngineSku: "C", lensSku: "D", rack: { placements: [{ sku: "E" }] } }]).join(",") === "A,B,C,D,E",
    "handoff:photos: scope — line skus, components, light engine / lens and rack placements");
  const lines = describeSelection(sel).join("\n");
  ok(/with a photo: 2 /.test(lines) && /documents to download from private Blob: 2/.test(lines) && /SKU-A {2}←/.test(lines), "handoff:photos: describeSelection — counts and the pick list");

  // --- the browser's map ---
  const manifest = { version: 1 as const, bySku: { "SKU-A": "PD-1", "SKU-B": "PD-5", "SKU-Z": "PD-404" }, byDoc: { "PD-1": "PD-1.webp", "PD-5": "PD-5.png", "../evil": "x.webp", "PD-7": "../../etc/passwd" }, linkOnly: [], failed: [] };
  const parsed = parsePhotoManifest(manifest)!;
  ok(Object.keys(parsed.byDoc).join() === "PD-1,PD-5" && Object.keys(parsed.bySku).join() === "SKU-A,SKU-B", "handoff:photos: parsePhotoManifest drops unsafe file names, unsafe ids and skus whose document is unknown");
  ok(parsePhotoManifest({ version: 2 }) === null && parsePhotoManifest(null) === null, "handoff:photos: parsePhotoManifest refuses a manifest of another version");
  const w: Record<string, unknown> = {};
  new Function("window", photosScript(parsed))(w);
  ok(JSON.stringify(w.PEAK_PHOTOS) === JSON.stringify({ bySku: { "SKU-A": "PD-1", "SKU-B": "PD-5" }, byDoc: { "PD-1": "images/PD-1.webp", "PD-5": "images/PD-5.png" } }),
    "handoff:photos: photosScript = window.PEAK_PHOTOS { bySku: sku → docId, byDoc: docId → images/<file> }");
  const withPhotos = sliceExport(exp, { photos: parsed });
  ok("data/photos.js" in withPhotos.files && withPhotos.hits.length === 0 && withPhotos.counts.photoFiles === 2, "handoff:slice: photos in → data/photos.js out (and the final scan still clean)");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-photos-"));
  try {
    const dataDir = path.join(tmp, "data"), imgDir = path.join(tmp, "images");
    fs.mkdirSync(imgDir, { recursive: true });
    ok(loadPhotoManifest(imgDir).manifest === null, "handoff:slice: loadPhotoManifest — no images/manifest.json → null");
    fs.writeFileSync(path.join(imgDir, "manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(imgDir, "PD-1.webp"), WEBP);
    const lm = loadPhotoManifest(imgDir);
    ok(lm.manifest !== null && Object.keys(lm.manifest.byDoc).join() === "PD-1" && lm.missing.join() === "PD-5" && Object.keys(lm.manifest.bySku).join() === "SKU-A",
      "handoff:slice: loadPhotoManifest — a document whose file is missing from images/ is left out of the map");
    ok(writeSlice(sliceExport(exp, { photos: lm.manifest }), dataDir) && fs.existsSync(path.join(dataDir, "photos.js")), "handoff:slice: writeSlice writes data/photos.js");
    ok(writeSlice(sliceExport(exp), dataDir) && !fs.existsSync(path.join(dataDir, "photos.js")), "handoff:slice: a re-slice without a manifest removes a stale data/photos.js");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- sniffing ---
  ok(sniffImageExt(WEBP) === "webp" && sniffImageExt(PNG) === "png" && sniffImageExt(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])) === "jpg" && sniffImageExt(new TextEncoder().encode("GIF89a")) === "gif" &&
    sniffImageExt(new TextEncoder().encode("<html>nope</html>")) === null, "handoff:photos: sniffImageExt — webp/png/jpg/gif by magic bytes; HTML is not an image");

  // --- the download, with a fake Blob client ---
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-photos-dl-"));
  try {
    const calls = new Map<string, number>();
    let inflight = 0, peak = 0;
    const secret = "tok_" + "SECRETVALUE123";
    const client: BlobClient = {
      async read(key) {
        calls.set(key, (calls.get(key) ?? 0) + 1);
        inflight++;
        peak = Math.max(peak, inflight);
        await new Promise((r) => setTimeout(r, 5));
        inflight--;
        const n = calls.get(key)!;
        if (key.includes("flaky") && n < 3) throw new Error("socket hang up");
        if (key.includes("dead")) throw new Error("503 using " + secret);
        if (key.includes("gone")) return null;
        if (key.includes("html")) return new TextEncoder().encode("<html>login</html>");
        return key.endsWith(".png") ? PNG : WEBP;
      },
    };
    const items = [
      ...Array.from({ length: 14 }, (_, i) => ({ docId: `PD-ok${i}`, blobKey: `part-docs/PD-ok${i}/p.webp` })),
      { docId: "PD-png", blobKey: "part-docs/PD-png/p.png" },
      { docId: "PD-flaky", blobKey: "part-docs/PD-flaky/p.webp" },
      { docId: "PD-dead", blobKey: "part-docs/PD-dead/p.webp" },
      { docId: "PD-gone", blobKey: "part-docs/PD-gone/p.webp" },
      { docId: "PD-html", blobKey: "part-docs/PD-html/p.webp" },
      { docId: "../bad", blobKey: "part-docs/x/p.webp" },
    ];
    const res = await downloadPhotos(items, { client, outDir: path.join(dl, "images"), backoffMs: 0, redact: [secret] });
    ok(res.downloaded === 16 && res.failed.length === 4, `handoff:photos: download — 16 written, 4 failed (${res.downloaded}/${res.failed.length})`);
    ok(fs.readFileSync(path.join(dl, "images", "PD-ok0.webp")).equals(Buffer.from(WEBP)) && fs.existsSync(path.join(dl, "images", "PD-png.png")), "handoff:photos: download — files keep their stored bytes, named <docId>.<ext> by their real format");
    ok(peak <= 6 && peak > 1, `handoff:photos: download — at most 6 in flight, and actually concurrent (peak ${peak})`);
    ok(calls.get("part-docs/PD-flaky/p.webp") === 3 && res.files["PD-flaky"] === "PD-flaky.webp", "handoff:photos: download — a flaky read is retried (2 retries → 3 attempts) and then lands");
    ok(calls.get("part-docs/PD-dead/p.webp") === 3 && res.failed.some((f) => f.docId === "PD-dead"), "handoff:photos: download — a persistent failure stops after 3 attempts and is recorded");
    ok(calls.get("part-docs/PD-gone/p.webp") === 1 && res.failed.find((f) => f.docId === "PD-gone")?.error === "not found in Blob", "handoff:photos: download — a missing blob is not retried");
    ok(res.failed.find((f) => f.docId === "PD-html")?.error === "the stored file is not an image" && !fs.existsSync(path.join(dl, "images", "PD-html.webp")), "handoff:photos: download — a non-image body is refused, not written");
    ok(!JSON.stringify(res.failed).includes(secret), "handoff:photos: download — the token is redacted from recorded errors");
    ok(res.failed.some((f) => f.docId === "../bad") && !fs.existsSync(path.join(dl, "bad.webp")), "handoff:photos: download — an unsafe document id is refused");
    const before = [...calls.values()].reduce((a, b) => a + b, 0);
    const again = await downloadPhotos(items.slice(0, 3), { client, outDir: path.join(dl, "images"), backoffMs: 0 });
    ok(again.reused === 3 && again.downloaded === 0 && [...calls.values()].reduce((a, b) => a + b, 0) === before, "handoff:photos: download — files already in the folder are reused (resume), --force would re-fetch");
    const bm = buildPhotoManifest([{ sku: "S1", docId: "PD-ok0", blobKey: "k", sourceUrl: null, via: "own" }, { sku: "S2", docId: "PD-dead", blobKey: "k", sourceUrl: null, via: "own" }, { sku: "S3", docId: "PD-L", blobKey: null, sourceUrl: "https://x.test/a", via: "own" }], res);
    ok(JSON.stringify(bm.bySku) === '{"S1":"PD-ok0"}' && bm.linkOnly.length === 1 && bm.linkOnly[0].sku === "S3" && bm.failed.some((f) => f.docId === "PD-dead"), "handoff:photos: manifest — maps only skus whose file exists; link-only and failed are recorded");

    // --- main(): dry run, missing token, a full run with the fake client ---
    const expPath = path.join(dl, "export.json");
    fs.writeFileSync(expPath, JSON.stringify(exp));
    const outDir = path.join(dl, "pkg", "images");
    const dry = await quiet(() => photosMain(["--in", expPath, "--out", outDir, "--dry-run"], {}, async () => { throw new Error("must not build a client in a dry run"); }));
    ok(dry.value === 0 && !fs.existsSync(outDir) && /with a photo: 2/.test(dry.out) && /dry run/.test(dry.out), "handoff:photos: --dry-run prints the selection, needs no token, writes nothing");
    const noTok = await quiet(() => photosMain(["--in", expPath, "--out", outDir], {}, async () => { throw new Error("must not build a client without a token"); }, dl));
    ok(noTok.value === 2 && /BLOB_READ_WRITE_TOKEN/.test(noTok.err) && !fs.existsSync(outDir), "handoff:photos: no BLOB_READ_WRITE_TOKEN → exit 2 with a clear message, nothing written");
    const usageRun = await quiet(() => photosMain(["--out", outDir], {}));
    ok(usageRun.value === 2, "handoff:photos: missing --in → exit 2");
    const v1Path = path.join(dl, "v1.json");
    fs.writeFileSync(v1Path, JSON.stringify({ ...exp, meta: { ...exp.meta, format: 1 } }));
    ok((await quiet(() => photosMain(["--in", v1Path, "--out", outDir, "--dry-run"], {}))).value === 2, "handoff:photos: a format-1 export → exit 2");
    const keys: string[] = [];
    const fake: BlobClient = { async read(k) { keys.push(k); return k.includes("PD-5") ? PNG : WEBP; } };
    const full = await quiet(() => photosMain(["--in", expPath, "--out", outDir], { BLOB_READ_WRITE_TOKEN: secret }, async () => fake, dl));
    const written = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8")) as { bySku: Record<string, string>; byDoc: Record<string, string> };
    ok(full.value === 0 && keys.sort().join() === "part-docs/PD-1/a.webp,part-docs/PD-5/beta.webp" && JSON.stringify(written.bySku) === '{"SKU-A":"PD-1","SKU-B":"PD-5"}' && written.byDoc["PD-5"] === "PD-5.png" &&
      !JSON.stringify(written).includes("part-docs") && !full.out.includes(secret) && !full.err.includes(secret),
      "handoff:photos: a run with a fake client downloads the 2 picked documents and writes images/manifest.json (no Blob keys, no token in output)");
    const failing: BlobClient = { async read() { throw new Error("boom"); } };
    const outFail = path.join(dl, "pkg-fail", "images");
    const bad = await quiet(() => photosMain(["--in", expPath, "--out", outFail, "--retries", "0"], { BLOB_READ_WRITE_TOKEN: secret }, async () => failing, dl));
    ok(bad.value === 1 && fs.existsSync(path.join(outFail, "manifest.json")) && /FAILED PD-1/.test(bad.err), "handoff:photos: failed downloads → exit 1, the manifest still written for the rest");
    // the real entry point
    const cleanEnv = { ...process.env };
    delete cleanEnv.BLOB_READ_WRITE_TOKEN;
    const cli = (args: string[]) => spawnSync("npx", ["tsx", "handoff/estimator/fetch-photos.ts", ...args], { cwd: process.cwd(), encoding: "utf8", timeout: 120_000, env: cleanEnv });
    const c1 = cli(["--in", expPath, "--out", path.join(dl, "cli-out"), "--dry-run"]);
    ok(c1.status === 0 && /with a photo: 2/.test(c1.stdout) && !fs.existsSync(path.join(dl, "cli-out")), `handoff:photos: CLI --dry-run exits 0 without a token (exit ${c1.status})`);
    const c2 = cli(["--in", expPath, "--out", path.join(dl, "cli-out")]);
    ok(c2.status === 2 && /BLOB_READ_WRITE_TOKEN/.test(c2.stderr) && !fs.existsSync(path.join(dl, "cli-out")), `handoff:photos: CLI without a token exits 2 (exit ${c2.status})`);
  } finally {
    fs.rmSync(dl, { recursive: true, force: true });
  }
  await photoFixChecks(ok, exp);
}

// ---------------------------------------------------------------------------------------------------------------
// Task 11 fix pass — Blob-key guard, atomic writes + safe resume, auth abort, prune, slicer warnings, private selection.

async function photoFixChecks(ok: Ok, exp: ExportV2) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-photos-fix-"));
  try {
    // --- 1. the Blob-key guard (mirrors blobPathBelongsTo) ---
    ok(blobKeyBelongsTo("part-docs/PD-1/a.webp", "PD-1") && blobKeyBelongsTo("part-docs/PD-1/a-b_c.1.webp", "PD-1"), "handoff:photos: blobKeyBelongsTo — part-docs/<docId>/<safe file> passes");
    const badKeys: Array<[string, string]> = [
      ["documents/PD-1/secret.pdf", "PD-1"], ["part-docs/PD-2/a.webp", "PD-1"], ["part-docs/PD-1/../PD-2/a.webp", "PD-1"], ["part-docs/PD-1/a/b.webp", "PD-1"],
      ["part-docs/PD-1/..", "PD-1"], ["part-docs/PD-1/.hidden", "PD-1"], ["part-docs/PD-1/a\u0001.webp", "PD-1"], ["part-docs/PD-1/%2e%2e.webp", "PD-1"],
      ["part-docs/PD-1/..\\PD-2\\x.webp", "PD-1"], ["part-docs/PD-1/", "PD-1"], ["part-docs/PD-1/a b.webp", "PD-1"], ["/part-docs/PD-1/a.webp", "PD-1"], ["part-docs/PD-1/a.webp", "../PD-1"],
    ];
    ok(badKeys.every(([k, d]) => !blobKeyBelongsTo(k, d)) && !blobKeyBelongsTo(null, "PD-1") && !blobKeyBelongsTo(42, "PD-1"),
      `handoff:photos: blobKeyBelongsTo — out-of-prefix, other-document, traversal, nested, encoded, control-character and empty keys all refused (${badKeys.filter(([k, d]) => blobKeyBelongsTo(k, d)).map(([k]) => k).join("|")})`);
    const gdir = path.join(tmp, "guard");
    const fetched: string[] = [];
    const gclient: BlobClient = { async read(k) { fetched.push(k); return WEBP; } };
    const gres = await downloadPhotos([
      { docId: "PD-evil", blobKey: "documents/X/secret.pdf" }, { docId: "PD-cross", blobKey: "part-docs/PD-other/a.webp" }, { docId: "PD-trav", blobKey: "part-docs/PD-trav/../x.webp" },
      { docId: "PD-fine", blobKey: "part-docs/PD-fine/a.webp" },
    ], { client: gclient, outDir: gdir, backoffMs: 0 });
    ok(fetched.join() === "part-docs/PD-fine/a.webp" && gres.failed.length === 3 && gres.failed.every((f) => f.error === "blob path outside part-docs/<docId>/") && Object.keys(gres.files).join() === "PD-fine",
      `handoff:photos: download — a blobKey outside part-docs/<docId>/ is recorded as failed and nothing is fetched for it (fetched ${fetched.join("|")})`);

    // --- 2. atomic writes + resume safety ---
    const rdir = path.join(tmp, "resume");
    fs.mkdirSync(path.join(rdir, "PD-dir.webp"), { recursive: true });
    fs.writeFileSync(path.join(rdir, "PD-dir.webp", "keep.txt"), "x");
    fs.writeFileSync(path.join(rdir, "PD-good.webp"), WEBP);
    fs.writeFileSync(path.join(rdir, "PD-trunc.webp"), WEBP.slice(0, 10));
    fs.writeFileSync(path.join(rdir, "PD-empty.webp"), "");
    fs.writeFileSync(path.join(rdir, "PD-wrongfmt.webp"), PNG);
    fs.writeFileSync(path.join(rdir, "PD-fmt.png"), WEBP);
    fs.writeFileSync(path.join(rdir, "PD-new.webp.part"), "half a file");
    const rcalls: string[] = [];
    const rclient: BlobClient = { async read(k) { rcalls.push(k); return WEBP; } };
    const ids = ["PD-good", "PD-trunc", "PD-empty", "PD-wrongfmt", "PD-fmt", "PD-new", "PD-dir"];
    const rres = await downloadPhotos(ids.map((d) => ({ docId: d, blobKey: `part-docs/${d}/p.webp` })), { client: rclient, outDir: rdir, backoffMs: 0 });
    ok(!rcalls.includes("part-docs/PD-good/p.webp") && rres.reused === 1 && ["PD-trunc", "PD-empty", "PD-wrongfmt", "PD-fmt", "PD-new"].every((d) => rcalls.includes(`part-docs/${d}/p.webp`)),
      `handoff:photos: resume — a whole file is reused; a truncated, empty, wrong-format or wrong-extension file is re-downloaded (calls ${rcalls.length})`);
    ok(["PD-trunc", "PD-empty", "PD-wrongfmt", "PD-new", "PD-fmt"].every((d) => fs.readFileSync(path.join(rdir, `${d}.webp`)).equals(Buffer.from(WEBP))) && !fs.existsSync(path.join(rdir, "PD-fmt.png")),
      "handoff:photos: resume — the re-downloaded files are whole, and a stale copy in another format is removed");
    ok(!fs.readdirSync(rdir).some((n) => n.endsWith(".part")) && rres.failed.length === 1 && rres.failed[0].docId === "PD-dir" && fs.existsSync(path.join(rdir, "PD-dir.webp", "keep.txt")),
      "handoff:photos: writes go to <file>.part then rename — a failed write is recorded and leaves no .part file behind");
    ok(completeImageExt(WEBP) === "webp" && completeImageExt(WEBP.slice(0, 10)) === null && completeImageExt(PNG) === "png" && completeImageExt(PNG.slice(0, 15)) === null &&
      completeImageExt(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9])) === "jpg" && completeImageExt(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2])) === null &&
      completeImageExt(new Uint8Array([...new TextEncoder().encode("GIF89a"), 0, 0x3b])) === "gif" && completeImageExt(new TextEncoder().encode("GIF89a\0\0")) === null,
      "handoff:photos: completeImageExt — format plus its own end marker (WebP length, PNG IEND, JPEG FFD9, GIF trailer)");

    // --- 3. a rejected token aborts early ---
    const acalls: string[] = [];
    const authFail: BlobClient = { async read(k) { acalls.push(k); throw new BlobAuthError("Access denied, please provide a valid token for this resource."); } };
    const aitems = Array.from({ length: 10 }, (_, i) => ({ docId: `PD-a${i}`, blobKey: `part-docs/PD-a${i}/p.webp` }));
    const ares = await downloadPhotos(aitems, { client: authFail, outDir: path.join(tmp, "auth"), concurrency: 1, backoffMs: 0 });
    ok(acalls.length === 3 && ares.aborted === AUTH_ABORT_MESSAGE && ares.failed.length === 3, `handoff:photos: 3 consecutive auth failures stop the run (no retries, ${acalls.length} of 10 documents tried)`);
    const status403: BlobClient = { async read(k) { acalls.push(k); throw Object.assign(new Error("Forbidden"), { status: 403 }); } };
    acalls.length = 0;
    ok((await downloadPhotos(aitems, { client: status403, outDir: path.join(tmp, "auth"), concurrency: 1, backoffMs: 0 })).aborted === AUTH_ABORT_MESSAGE && acalls.length === 3, "handoff:photos: an error carrying HTTP status 403 (or 401) counts as an auth failure");
    let n = 0;
    const mixed: BlobClient = { async read() { n++; if (n % 3 === 0) return WEBP; throw new BlobAuthError(); } };
    const mres = await downloadPhotos(aitems, { client: mixed, outDir: path.join(tmp, "auth2"), concurrency: 1, backoffMs: 0 });
    ok(!mres.aborted && mres.downloaded === 3 && mres.failed.length === 7, "handoff:photos: a success resets the streak — only CONSECUTIVE auth failures abort");
    // main(): needs three documents to download
    const big = clone(exp);
    const bdocs = big.collections!.part_documents as unknown[];
    const blinks = big.collections!.part_document_links as unknown[];
    const fa = (big.collections!.subassemblies as Array<{ id: string; doc: Record<string, unknown> }>).find((f) => f.id === "fa-1")!;
    const extraLines: Array<{ sku: string; qty: number }> = [];
    for (let i = 0; i < 4; i++) {
      bdocs.push(mkRow(`PD-X${i}`, { id: `PD-X${i}`, kind: "image", blobKey: `part-docs/PD-X${i}/x.webp`, source: "upload" }));
      blinks.push({ id: `LX${i}`, doc: { id: `LX${i}`, partSku: `SKU-X${i}`, documentId: `PD-X${i}`, kind: "image" } });
      extraLines.push({ sku: `SKU-X${i}`, qty: 1 });
    }
    fa.doc.lines = [...((fa.doc.lines as Array<{ sku: string; qty: number }>) ?? []), ...extraLines];
    const bigPath = path.join(tmp, "big.json");
    fs.writeFileSync(bigPath, JSON.stringify(big));
    const outAuth = path.join(tmp, "pkg-auth", "images");
    const authRun = await quiet(() => photosMain(["--in", bigPath, "--out", outAuth, "--concurrency", "1"], { BLOB_READ_WRITE_TOKEN: "tok_" + "x" }, async () => authFail, tmp));
    ok(authRun.value === 1 && authRun.err.includes(AUTH_ABORT_MESSAGE) && !fs.existsSync(path.join(outAuth, "manifest.json")), "handoff:photos: main — a rejected token exits 1 with 'Blob token rejected — check BLOB_READ_WRITE_TOKEN' and writes no manifest");

    // --- 5. unreferenced files: warn, --prune ---
    const pdir = path.join(tmp, "pkg-prune", "images");
    const pclient: BlobClient = { async read(k) { return k.includes("PD-X0") ? PNG : WEBP; } };
    fs.mkdirSync(pdir, { recursive: true });
    // an earlier handoff:photos folder (it holds our manifest.json) — the only kind of non-empty --out allowed
    fs.writeFileSync(path.join(pdir, "manifest.json"), JSON.stringify({ version: 1, bySku: {}, byDoc: {}, linkOnly: [], failed: [] }));
    for (const f of ["PD-OLD.webp", "PD-OLD2.png"]) fs.writeFileSync(path.join(pdir, f), WEBP);
    fs.writeFileSync(path.join(pdir, "notes.txt"), "keep me");
    const warnRun = await quiet(async () => { const w: string[] = []; const o = console.warn; console.warn = (...a: unknown[]) => { w.push(a.join(" ")); }; try { return { code: await photosMain(["--in", bigPath, "--out", pdir], { BLOB_READ_WRITE_TOKEN: "tok_" + "x" }, async () => pclient, tmp), w }; } finally { console.warn = o; } });
    ok(warnRun.value.code === 0 && warnRun.value.w.some((l) => /3 unreferenced files in images\/ — delete them or pass --prune/.test(l)) && fs.existsSync(path.join(pdir, "PD-OLD.webp")),
      `handoff:photos: after a run, unreferenced files in images/ are warned about, not deleted (${warnRun.value.w.join(" / ").slice(0, 120)})`);
    const pruneRun = await quiet(() => photosMain(["--in", bigPath, "--out", pdir, "--prune"], { BLOB_READ_WRITE_TOKEN: "tok_" + "x" }, async () => pclient, tmp));
    const left = fs.readdirSync(pdir).sort();
    ok(pruneRun.value === 0 && !left.includes("PD-OLD.webp") && !left.includes("PD-OLD2.png") && left.includes("notes.txt") && left.includes("manifest.json") && left.includes("PD-1.webp") && left.includes("PD-X0.png"),
      `handoff:photos: --prune deletes only unreferenced IMAGE_FILE_RE files (a notes.txt and every referenced file stay) — left: ${left.join(",")}`);
    const rec = reconcileImagesDir(pdir, { byDoc: { "PD-1": "PD-1.webp" } }, true);
    ok(rec.pruned.includes("PD-X0.png") && rec.remaining.join() === "notes.txt", "handoff:photos: reconcileImagesDir — prune never touches a non-image file");

    // --- A7. the --out guard: inside output/, and empty / missing / an earlier handoff:photos folder only ---
    const stranger = path.join(tmp, "Downloads-like");
    fs.mkdirSync(stranger, { recursive: true });
    fs.writeFileSync(path.join(stranger, "family-photo.webp"), WEBP);
    fs.writeFileSync(path.join(stranger, "taxes.pdf"), "x");
    const strangerRun = await quiet(() => photosMain(["--in", bigPath, "--out", stranger, "--prune"], { BLOB_READ_WRITE_TOKEN: "tok_" + "x" }, async () => pclient, tmp));
    ok(strangerRun.value === 2 && /not empty and holds no handoff:photos manifest\.json/.test(strangerRun.err) && fs.readdirSync(stranger).sort().join() === "family-photo.webp,taxes.pdf",
      "handoff:photos A7: a non-empty --out with no handoff manifest is refused (exit 2) — --prune deletes nothing, nothing is written");
    const outside = path.join(os.tmpdir(), "handoff-photos-outside-" + process.pid);
    const outsideRun = await quiet(() => photosMain(["--in", bigPath, "--out", outside], { BLOB_READ_WRITE_TOKEN: "tok_" + "x" }, async () => pclient, path.join(tmp, "output")));
    ok(outsideRun.value === 2 && /must be inside/.test(outsideRun.err) && !fs.existsSync(outside), "handoff:photos A7: an --out outside output/ is refused (exit 2), nothing written");
    const fakeMan = path.join(tmp, "fake-man");
    fs.mkdirSync(fakeMan, { recursive: true });
    fs.writeFileSync(path.join(fakeMan, "manifest.json"), '{"not":"ours"}');
    ok(photosOutProblem(tmp, fakeMan) !== null && photosOutProblem(tmp, path.join(tmp, "nope")) === null && photosOutProblem(tmp, pdir) === null && photosOutProblem(tmp, tmp) !== null,
      "handoff:photos A7: photosOutProblem — someone else's manifest.json is refused; a missing folder and an earlier handoff folder are fine; output/ itself is refused");
    ok(photosOutProblem(DEFAULT_OUTPUT_ROOT, path.join(DEFAULT_OUTPUT_ROOT, "peak-estimator-handoff", "images-new-" + process.pid)) === null && path.basename(DEFAULT_OUTPUT_ROOT) === "output",
      "handoff:photos A7: the default output root is the repo's output/ folder");

    // --- 7/8. the private selection never ships; fetch errors are secret-scanned ---
    const sl = sliceExport(exp);
    ok(!("data/photo-manifest.json" in sl.files) && Object.values(sl.files).every((b) => !b.includes("part-docs/")), "handoff:slice: no sliced file contains a private Blob pathname");
    const leaky: BlobClient = { async read() { throw new Error("upstream said: " + T.github + " bad"); } };
    const outLeak = path.join(tmp, "pkg-leak", "images");
    const leakRun = await quiet(() => photosMain(["--in", bigPath, "--out", outLeak, "--retries", "0"], { BLOB_READ_WRITE_TOKEN: "tok_" + "x" }, async () => leaky, tmp));
    ok(leakRun.value === 1 && /SECRET SCAN/.test(leakRun.err) && !fs.existsSync(path.join(outLeak, "manifest.json")) && !leakRun.err.includes(T.github) && !leakRun.out.includes(T.github),
      "handoff:photos: a secret-shaped fetch error recorded in failed[] stops images/manifest.json from being written");
    const pathy: BlobClient = { async read(k) { throw new Error(`The requested blob does not exist: ${k}`); } };
    const outPathy = path.join(tmp, "pkg-pathy", "images");
    await quiet(() => photosMain(["--in", bigPath, "--out", outPathy, "--retries", "0"], { BLOB_READ_WRITE_TOKEN: "tok_" + "x" }, async () => pathy, tmp));
    ok(fs.existsSync(path.join(outPathy, "manifest.json")) && !fs.readFileSync(path.join(outPathy, "manifest.json"), "utf8").includes("part-docs/"), "handoff:photos: a Blob pathname quoted in an error never reaches images/manifest.json");

    // token-shaped sku key in the photo manifest → the slicer refuses (data/photos.js is scanned)
    const tokenSku = sliceExport(exp, { photos: { version: 1, bySku: { [T.github]: "PD-1" }, byDoc: { "PD-1": "PD-1.webp" }, linkOnly: [], failed: [] } });
    ok(tokenSku.hits.some((h) => h.file === "data/photos.js") && writeSlice(tokenSku, path.join(tmp, "refused")) === false && !fs.existsSync(path.join(tmp, "refused")),
      "handoff:slice: a token-shaped sku key in the photo manifest makes the slicer refuse (data/photos.js is scanned) and write nothing");

    // --- 6. slicer: missing-photo warning, unreadable manifest ---
    const expPath = path.join(tmp, "export.json");
    fs.writeFileSync(expPath, JSON.stringify(exp));
    const pkg = path.join(tmp, "slice-pkg");
    fs.mkdirSync(path.join(pkg, "images"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "images", "PD-1.webp"), WEBP);
    fs.writeFileSync(path.join(pkg, "images", "manifest.json"), JSON.stringify({ version: 1, bySku: { "SKU-A": "PD-1" }, byDoc: { "PD-1": "PD-1.webp" }, linkOnly: [], failed: [] }));
    const sw = await quiet(async () => { const w: string[] = []; const o = console.warn; console.warn = (...a: unknown[]) => { w.push(a.join(" ")); }; try { return { code: sliceRun(["--in", expPath, "--out", path.join(pkg, "data")]), w }; } finally { console.warn = o; } });
    ok(sw.value.code === 0 && sw.value.w.some((l) => /1 picked parts have no downloaded photo \(SKU-B\)/.test(l)) && fs.existsSync(path.join(pkg, "data", "photos.js")),
      `handoff:slice: a manifest lacking picked skus warns 'N picked parts have no downloaded photo' (${sw.value.w.join(" / ").slice(0, 100)})`);
    fs.writeFileSync(path.join(pkg, "images", "manifest.json"), "{ not json");
    const bad = await quiet(async () => sliceRun(["--in", expPath, "--out", path.join(pkg, "data2")]));
    ok(bad.value === 1 && /images[\\/]manifest\.json is unreadable — re-run handoff:photos/.test(bad.err) && !/\bat \w|Error:|node:/.test(bad.err) && !fs.existsSync(path.join(pkg, "data2")),
      `handoff:slice: a malformed images/manifest.json exits 1 with a one-line message, no stack, nothing written (${bad.err.trim().slice(0, 120)})`);
    fs.writeFileSync(path.join(pkg, "images", "manifest.json"), JSON.stringify({ version: 9 }));
    ok((await quiet(async () => sliceRun(["--in", expPath, "--out", path.join(pkg, "data2")]))).value === 1, "handoff:slice: a manifest of another version also exits 1 cleanly");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Final review A1–A4. Plants every dropped field on a revision, its docFields, a vendor quote (top level and in a
 *  revision), review / pdfOptions / packageSelection / history — the slicer must strip each. */
async function revisionAllowListChecks(ok: Ok, exp: ExportV2) {
  const BLOB = "quote-pdfs/Q-G001/rev-1-secretpath.pdf";
  const planted = JSON.parse(JSON.stringify(exp)) as ExportV2;
  const qrow = (planted.collections!.quotes as Array<{ id: string; doc: Record<string, unknown> }>).find((r) => r.id === "Q-G001")!;
  const vq = () => ({
    id: "vq-1", vendor: "Acme Rigging", quoteNumber: "AR-77", description: "Motors", total: 1200, totalSource: "lines",
    includesFreight: true, display: "itemized", addedAt: 5,
    lines: [{ id: 1, description: "Hoist", manufacturerPartNumber: "H-1", qty: 2, unit: "ea", amount: 600, extractedIndex: 0 }],
    attachment: { name: "q.pdf", mime: "application/pdf", dataUrl: "data:application/pdf;base64,SECRETBYTES", blobPath: "vendor-quotes/Q-G001/vq-1.pdf" },
    link: "https://vendor.example/portal?token=VENDORTOKEN", terms: "NET-30-INTERNAL-TERMS", notes: "INTERNAL-VENDOR-NOTE",
    fromThreadId: "thr-PRIVATE", extracted: { runId: "run-PRIVATE", model: "m", at: 1, data: {} }, vendorCompanyId: "c-vendor-PRIVATE",
  });
  qrow.doc.vendorQuotes = [vq()];
  qrow.doc.review = { state: "approved", reviewer: "Jeff", submittedBy: null, submittedAt: null, decidedBy: "Jeff", decidedAt: 1, note: "", method: "self", smuggled: "REVIEW-EXTRA" };
  qrow.doc.pdfOptions = { detail: "itemized", pdfQty: true, smuggled: "PDFOPT-EXTRA" };
  qrow.doc.packageSelection = { estimatePdf: true, coverPdf: true, drawings: true, excludedDatasheets: [], smuggled: "PKGSEL-EXTRA" };
  qrow.doc.history = [{ at: 1, to: "draft", by: "HISTORY-EXTRA" }];
  qrow.doc.pdf = { status: "ready", blobPath: "quote-pdfs/Q-G001/live.pdf" };
  qrow.doc.revisions = [{
    rev: 1, at: 1, by: "Jeff", reason: "sent", note: "", name: "Rev", customerId: "c-alpha", value: 100, margin: 0.3,
    pricingTier: "standard", tierMargin: 0.3, status: "sent", quoteType: "system", spec: { sections: [] },
    flameTest: { secret: "FLAME-PAYLOAD" }, repair: null, inspection: null, consulting: null, rental: null,
    pdfBlobPath: BLOB, pdfSavedAt: 9, smuggled: "REV-EXTRA",
    vendorQuotes: [vq()],
    docFields: {
      customer: "Alpha", locationId: null, contactName: null, quoteNote: "", assumptions: "", installTimeframe: "", preparedBy: "",
      owner: "", termsText: "", paymentTerms: null, source: "estimator", coverSummary: "", notIncluded: null, revNo: 1, issuedAt: 2,
      pdfOptions: { detail: "itemized", smuggled: "DOC-PDFOPT-EXTRA" },
      packageSelection: { estimatePdf: true, coverPdf: true, drawings: true, excludedDatasheets: [], smuggled: "DOC-PKGSEL-EXTRA" },
      packageFiles: [{ id: "pf1", name: "plan.pdf", blobPath: "estimate-files/Q-G001/plan.pdf" }],
      bid: { dueAt: 1, addenda: ["ADDENDUM-PRIVATE"] }, awardedPartyId: "pty_PRIVATE", portalFirm: { validUntil: 1 },
    },
  }];
  const res = sliceExport(planted);
  const w: Record<string, unknown> = {};
  new Function("window", res.files["data/estimates.js"])(w);
  const q = (w.PEAK_ESTIMATES as Array<Record<string, unknown>>).find((x) => x.id === "Q-G001")!;
  const body = res.files["data/estimates.js"];
  const rev = (q.revisions as Array<Record<string, unknown>>)[0];
  ok(res.hits.length === 0, "handoff:slice A1: the planted slice still passes the final secret scan");
  for (const k of ["pdfBlobPath", "pdfSavedAt", "flameTest", "repair", "inspection", "consulting", "rental", "smuggled"])
    ok(!(k in rev), `handoff:slice A1: a revision's ${k} is dropped`);
  ok(Object.keys(rev).every((k) => (REVISION_FIELDS as readonly string[]).includes(k)) && rev.rev === 1 && rev.value === 100 && rev.status === "sent",
    `handoff:slice A1: a revision keeps only REVISION_FIELDS (got ${Object.keys(rev).join(",")})`);
  const df = rev.docFields as Record<string, unknown>;
  for (const k of ["packageFiles", "bid", "awardedPartyId", "portalFirm"]) ok(!(k in df), `handoff:slice A1: docFields.${k} is dropped`);
  ok(Object.keys(df).every((k) => (DOC_FIELDS as readonly string[]).includes(k)) && df.customer === "Alpha" && df.revNo === 1 && df.issuedAt === 2,
    "handoff:slice A1: docFields keeps only the header/print fields (DOC_FIELDS)");
  ok(!("smuggled" in (df.pdfOptions as object)) && !("smuggled" in (df.packageSelection as object)),
    "handoff:slice A1: docFields.pdfOptions / packageSelection are allow-listed again");
  ok(!("smuggled" in (q.review as object)) && (q.review as Record<string, unknown>).method === "self", "handoff:slice A1: review is allow-listed (REVIEW_FIELDS)");
  ok(!("smuggled" in (q.pdfOptions as object)) && !("smuggled" in (q.packageSelection as object)), "handoff:slice A1: top-level pdfOptions / packageSelection allow-listed");
  ok(!("by" in (q.history as Array<Record<string, unknown>>)[0]), "handoff:slice A1: history entries keep { at, from, to } only");
  ok(!("pdf" in q), "handoff:slice A1: the live quote's pdf state (blobPath) never ships");
  for (const where of [["top", (q.vendorQuotes as Array<Record<string, unknown>>)[0]], ["revision", (rev.vendorQuotes as Array<Record<string, unknown>>)[0]]] as const) {
    const v = where[1];
    ok(!!v && v.vendor === "Acme Rigging" && v.quoteNumber === "AR-77" && v.total === 1200 && v.includesFreight === true && v.display === "itemized",
      `handoff:slice A2: ${where[0]} vendor quote keeps its render fields`);
    for (const k of ["attachment", "link", "terms", "notes", "fromThreadId", "extracted", "vendorCompanyId"]) ok(!(k in v), `handoff:slice A2: ${where[0]} vendor quote drops ${k}`);
    ok(Object.keys(v).every((k) => (VENDOR_QUOTE_FIELDS as readonly string[]).includes(k)), `handoff:slice A2: ${where[0]} vendor quote keys ⊆ VENDOR_QUOTE_FIELDS`);
    const line = (v.lines as Array<Record<string, unknown>>)[0];
    ok(line.description === "Hoist" && line.amount === 600 && !("extractedIndex" in line), `handoff:slice A2: ${where[0]} vendor line keeps render fields, drops extractedIndex`);
  }
  for (const needle of [BLOB, "quote-pdfs/", "vendor-quotes/", "estimate-files/", "SECRETBYTES", "VENDORTOKEN", "NET-30-INTERNAL-TERMS", "INTERNAL-VENDOR-NOTE",
    "thr-PRIVATE", "run-PRIVATE", "c-vendor-PRIVATE", "ADDENDUM-PRIVATE", "pty_PRIVATE", "FLAME-PAYLOAD", "EXTRA"])
    ok(!body.includes(needle), `handoff:slice A1/A2: estimates.js never carries ${needle}`);
  ok((QUOTE_FIELDS as readonly string[]).includes("vendorQuotes"), "handoff:slice A2: vendorQuotes is on QUOTE_FIELDS (render-only)");
  ok(JSON.stringify(sanitizeQuote(sanitizeQuote(qrow.doc))) === JSON.stringify(sanitizeQuote(qrow.doc)), "handoff:slice A1: sanitizeQuote is idempotent");
  {
    // The README lists every Quote field the bundle drops; this fails when a field is added to / removed from the Quote
    // type (or QUOTE_FIELDS) without that list — and the README paragraph "What an estimate carries" — being revisited.
    const qf = "src/lib/stores/quotes.ts";
    const sf = ts.createSourceFile(qf, fs.readFileSync(path.resolve(__dirname, "..", qf), "utf8"), ts.ScriptTarget.ES2020, true);
    const keys: string[] = [];
    sf.forEachChild((n) => {
      if ((ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) && n.name.text === "Quote") {
        const members = ts.isInterfaceDeclaration(n) ? n.members : (n.type as ts.TypeLiteralNode).members;
        members.forEach((m) => { if (m.name) keys.push(m.name.getText(sf)); });
      }
    });
    const dropped = keys.filter((k) => !(QUOTE_FIELDS as readonly string[]).includes(k)).sort().join(" ");
    const expected = ["assistDraft", "assistNudge", "assistNudgeLeaseUntil", "bid", "bidScopeOnly", "bonusRecord", "clientResponses", "consulting", "contact", "contentChangedAt",
      "emailSending", "estimateEmails", "estimatorBonusSplit", "findingKeys", "flameTest", "inspection", "leadId", "legacyOwner", "margin", "packageFiles", "pdf", "poReceivedAt",
      "portalAcceptance", "portalDecline", "portalFirm", "portalReview", "quoteBasis", "renewalOf", "rental", "repair", "reviewComments", "scopeNarrative", "shareLink", "shareOpens",
      "termsText", "value"].sort().join(" ");
    ok(keys.length > 60 && dropped === expected, `handoff:slice: the Quote fields the bundle drops are exactly the README's list (${dropped === expected ? "match" : `got: ${dropped}`})`);
  }
  {
    // the won version's pointer and the package header switch ship (the revisions wonRev points at ship too)
    const sq = sanitizeQuote({ ...qrow.doc, status: "won", wonRev: 3, packagePeakHeader: false } as never) as Record<string, unknown>;
    ok((QUOTE_FIELDS as readonly string[]).includes("wonRev") && (QUOTE_FIELDS as readonly string[]).includes("packagePeakHeader") && sq.wonRev === 3 && sq.packagePeakHeader === false,
      "handoff:slice: wonRev and packagePeakHeader are on QUOTE_FIELDS and survive sanitizeQuote");
  }
  // extras (dev) are sanitized too, even when handed in raw
  const raw = sliceExport({ ...exp, collections: { ...exp.collections, quotes: [] } } as ExportV2, { extraEstimates: [{ ...qrow.doc, id: "Q-X1" } as never] });
  ok(!raw.files["data/estimates.js"].includes(BLOB) && !raw.files["data/estimates.js"].includes("SECRETBYTES"), "handoff:slice A1: a raw extra estimate is sanitized by sliceExport");

  // A3 — the portal's self-built catalog quotes never ship
  ok((EXCLUDED_SOURCES as readonly string[]).includes("portal-catalog"), "handoff:slice A3: EXCLUDED_SOURCES names portal-catalog");
  const withPortal = JSON.parse(JSON.stringify(exp)) as ExportV2;
  const g1 = (withPortal.collections!.quotes as Array<{ id: string; doc: Record<string, unknown> }>).find((r) => r.id === "Q-G001")!;
  withPortal.collections!.quotes.push({ id: "Q-PORTAL", doc: { ...JSON.parse(JSON.stringify(g1.doc)), source: "portal-catalog" } } as never);
  withPortal.collections!.quotes.push({ id: "Q-QUICK", doc: { ...JSON.parse(JSON.stringify(g1.doc)), source: "quick" } } as never);
  const sel = selectEstimates(withPortal.collections!.quotes as never).map((x) => x.id);
  ok(!sel.includes("Q-PORTAL") && !sel.includes("Q-QUICK") && sel.includes("Q-G001"), `handoff:slice A3: a portal-catalog quote is excluded, and so is a Quick Design one (only Estimator-built quotes ship, Oct 20); Q-G001 kept (${sel.join(",")})`);

  // A4 — bolt width rides with the catalog (lin-yd fabric weights)
  ok((CATALOG_FIELDS as readonly string[]).includes("boltWidthIn"), "handoff:slice A4: CATALOG_FIELDS carries boltWidthIn");
  const withBolt = JSON.parse(JSON.stringify(exp)) as ExportV2;
  const part = (withBolt.collections!.catalog_parts as Array<{ id: string; doc: Record<string, unknown> }>).find((r) => r.id === "SKU-B")!;
  Object.assign(part.doc, { oz: 16, ozBasis: "lin-yd", boltWidthIn: 54 });
  const wb = sliceExport(withBolt);
  const cw: Record<string, unknown> = {};
  new Function("window", wb.files["data/catalog-1.js"])(cw);
  const pb = (cw.PEAK_CATALOG as Array<Record<string, unknown>>).find((x) => x.id === "SKU-B")!;
  ok(pb.boltWidthIn === 54 && pb.ozBasis === "lin-yd" && pb.oz === 16, "handoff:slice A4: a lin-yd fabric keeps oz / ozBasis / boltWidthIn in catalog-N.js");
}


// ---------------------------------------------------------------------------------------------------------------
// Jeff Oct 20 — only Estimator estimates from the last 4 weeks, and only the catalog parts they need.

const DAY = 86_400_000;
const EXPORTED = "2026-10-20T00:00:00.000Z";
const EXPORTED_MS = Date.parse(EXPORTED);

/** A one-line system quote document with one line naming `sku`. */
const quoteDoc = (sku: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  quoteType: "system", name: `Quote ${sku}`, customer: "Alpha Schools", customerId: "c-alpha", status: "draft", source: "estimator", updatedAt: EXPORTED_MS - DAY,
  spec: { sections: [{ id: "s1", name: "Sys", kind: "lighting", mfr: "", freightPct: 0, items: [{ id: 1, sku, desc: sku, qty: 1, unit: "ea", cost: 1, price: 2 }] }] },
  ...over,
});
const part = (sku: string, over: Record<string, unknown> = {}) => mkRow(sku, { sku, desc: sku, category: "Misc", unit: "ea", cost: 10, list: 20, ...over });

function exportWith(base: ExportV2, o: { quotes?: Array<ReturnType<typeof mkRow>>; parts?: Array<ReturnType<typeof mkRow>>; fixtures?: Array<ReturnType<typeof mkRow>>; blobs?: Array<{ id: string; data: unknown }>; exportedAt?: string | null }): ExportV2 {
  const e = clone(base);
  e.meta = { ...e.meta, exportedAt: o.exportedAt === null ? undefined : (o.exportedAt ?? EXPORTED) };
  e.collections = { ...e.collections, quotes: (o.quotes ?? []) as never, catalog_parts: (o.parts ?? []) as never, subassemblies: (o.fixtures ?? []) as never, part_documents: [], part_document_links: [], manufacturers: [] };
  e.blobs = (o.blobs ?? []) as never;
  return e;
}

const sliceIds = (r: ReturnType<typeof sliceExport>): string[] => {
  const w: Record<string, unknown> = {};
  new Function("window", r.files["data/estimates.js"])(w);
  return (w.PEAK_ESTIMATES as Array<{ id: string }>).map((q) => q.id);
};
const sliceCatalog = (r: ReturnType<typeof sliceExport>): Array<Record<string, unknown>> => {
  const out: Array<Record<string, unknown>> = [];
  for (const f of Object.keys(r.files).filter((n) => /^data\/catalog-\d+\.js$/.test(n))) {
    const w: Record<string, unknown> = {};
    new Function("window", r.files[f])(w);
    out.push(...((w.PEAK_CATALOG ?? []) as Array<Record<string, unknown>>));
  }
  return out;
};

async function recentSelectionChecks(ok: Ok, fixture: ExportV2) {
  // --- parseRecentDays / the window ---
  ok(DEFAULT_RECENT_DAYS === 28 && parseRecentDays(undefined) === 28 && parseRecentDays("7") === 7 && parseRecentDays(" 90 ") === 90 && parseRecentDays("3650") === 3650,
    "handoff:recent: --recent-days defaults to 28 and accepts a whole number of days");
  const bad = (raw: string) => { try { parseRecentDays(raw); return null; } catch (e) { return e instanceof SelectionError ? e.code : "other"; } };
  ok(["0", "-1", "abc", "1.5", "", "3651", "7d", "NaN"].every((raw) => bad(raw) === "bad-recent-days"), "handoff:recent: --recent-days refuses 0, negatives, fractions, text, empty and > 3650");
  const w = recentWindow(EXPORTED, 28);
  ok(w.fromMs === EXPORTED_MS - 28 * DAY && w.toMs === EXPORTED_MS && w.exportedAt === EXPORTED, "handoff:recent: the window is exportedAt − days … exportedAt");
  ok(["", null, undefined, "not a date", 0].every((x) => { try { recentWindow(x); return false; } catch (e) { return e instanceof SelectionError && e.code === "no-exported-at"; } }), "handoff:recent: an export without a usable exportedAt is refused");

  // --- the boundary, anchored to exportedAt (never the clock) ---
  const q = (id: string, over: Record<string, unknown>) => mkRow(id, quoteDoc(`P-${id}`, over));
  const inWindow = (e: ExportV2, days?: number) => selectBundledEstimates((e.collections!.quotes) as never, e.meta?.exportedAt, days).estimates.map((x) => x.id).join(",");
  const edge = exportWith(clone(fixture), {
    quotes: [
      q("Q-AT", { updatedAt: EXPORTED_MS - 28 * DAY }),              // exactly 28 days before: in
      q("Q-JUST-OUT", { updatedAt: EXPORTED_MS - 28 * DAY - 1 }),    // 1 ms older: out
      q("Q-NOW", { updatedAt: EXPORTED_MS }),                        // at the export: in
      q("Q-FUTURE", { updatedAt: EXPORTED_MS + 1 }),                 // after the export (clock skew): out
      q("Q-OLD", { updatedAt: EXPORTED_MS - 400 * DAY }),
      q("Q-CREATED", { updatedAt: undefined, createdAt: EXPORTED_MS - 3 * DAY }), // no updatedAt → createdAt
      q("Q-CREATED-OLD", { updatedAt: undefined, createdAt: EXPORTED_MS - 90 * DAY }),
      q("Q-UPD-WINS", { updatedAt: EXPORTED_MS - 90 * DAY, createdAt: EXPORTED_MS - 1 * DAY }), // updatedAt, not createdAt, decides
      q("Q-NOSTAMP", { updatedAt: undefined }),                       // neither → not recent
      q("Q-STRING-STAMP", { updatedAt: String(EXPORTED_MS - 2 * DAY) }), // a numeric string still reads as a time (Number())
    ],
  });
  ok(inWindow(edge) === "Q-AT,Q-CREATED,Q-NOW,Q-STRING-STAMP", `handoff:recent: boundary — exactly exportedAt−28d is in, 1 ms older is out, a future stamp is out, createdAt is the fallback, no stamp is out (got ${inWindow(edge)})`);
  ok(inWindow(edge, 7) === "Q-CREATED,Q-NOW,Q-STRING-STAMP" && inWindow(edge, 1).split(",").join() === "Q-NOW", `handoff:recent: a narrower --recent-days narrows (7 days: ${inWindow(edge, 7)})`);
  ok(inWindow(edge, 500).includes("Q-OLD") && inWindow(edge, 500).includes("Q-UPD-WINS") && !inWindow(edge, 500).includes("Q-FUTURE") && !inWindow(edge, 500).includes("Q-NOSTAMP"), "handoff:recent: a wider --recent-days (500) takes the old quotes in; future and unstamped stay out");
  ok(quoteStamp({ updatedAt: 5, createdAt: 9 }) === 5 && quoteStamp({ createdAt: 9 }) === 9 && quoteStamp({}) === null && quoteStamp({ updatedAt: "x" }) === null, "handoff:recent: quoteStamp = updatedAt, else createdAt, else null");
  // the same export with a later exportedAt moves the window (anchored to the export, not Date.now())
  const later = clone(edge);
  later.meta = { ...later.meta, exportedAt: new Date(EXPORTED_MS + 100 * DAY).toISOString() };
  ok(inWindow(later) === "", "handoff:recent: moving exportedAt forward moves the window — a slice is reproducible, never a function of today's date");

  // --- sources: only the Estimator's quotes ---
  const sources: Array<[string | undefined | null, boolean]> = [
    ["estimator", true], ["", true], [undefined, true], [null, true],
    ["grid", false], ["quick", false], ["inbox", false], ["daylite", false], ["portal-catalog", false], ["portal-self-serve", false], ["portal-service", false], ["rental", false], ["assist", false], ["sandbox", false],
  ];
  const srcExp = exportWith(clone(fixture), { quotes: sources.map(([src], i) => q(`Q-S${i}`, src === undefined ? { source: undefined } : { source: src })) });
  const got = inWindow(srcExp).split(",").filter(Boolean);
  const want = sources.map(([, keep], i) => (keep ? `Q-S${i}` : "")).filter(Boolean).sort();
  ok(got.sort().join() === want.join(), `handoff:recent: only Estimator-built quotes (source estimator / empty / absent) are bundled (got ${got.join()})`);
  ok(ESTIMATOR_SOURCES.join("|") === "estimator|" && (EXCLUDED_SOURCES as readonly string[]).includes("daylite"), "handoff:recent: ESTIMATOR_SOURCES = estimator and empty");
  const typed = exportWith(clone(fixture), { quotes: [q("Q-FLAME", { quoteType: "flame_test" }), q("Q-DEL", {}), mkRow("Q-DELETED", quoteDoc("P-x"), true), q("Q-EMPTY", { spec: { sections: [{ id: "s", items: [] }] } }), q("Q-OK", {})] });
  ok(inWindow(typed) === "Q-DEL,Q-OK", `handoff:recent: the older filters stand — live, system, at least one line (got ${inWindow(typed)})`);

  // --- sliceExport refuses with a clear error ---
  const refusal = (e: ExportV2, opts: Parameters<typeof sliceExport>[1] = {}) => { try { sliceExport(e, opts); return null; } catch (err) { return err instanceof SelectionError ? err : new Error("other: " + String(err)); } };
  const none = refusal(exportWith(clone(fixture), { quotes: [q("Q-OLD", { updatedAt: EXPORTED_MS - 90 * DAY })] }));
  ok(none instanceof SelectionError && none.code === "no-estimates" && /28 days/.test(none.message) && /2026-09-22/.test(none.message) && /2026-10-20/.test(none.message) && /--recent-days/.test(none.message),
    `handoff:recent: zero qualifying estimates → refused, naming the window and the flag (${none?.message.slice(0, 80)}…)`);
  const noAt = refusal(exportWith(clone(fixture), { quotes: [q("Q-1", {})], exportedAt: null }));
  ok(noAt instanceof SelectionError && noAt.code === "no-exported-at", "handoff:recent: no meta.exportedAt → refused (sliceExport)");
  ok(noEstimatesMessage(w).includes("last 28 days"), "handoff:recent: the refusal text names the window");

  // --- extras are exempt from the window and their SKUs ship ---
  const extraBase = exportWith(clone(fixture), {
    quotes: [q("Q-NEW", { updatedAt: EXPORTED_MS - DAY })],
    parts: [part("P-Q-NEW"), part("P-EXTRA"), part("P-UNUSED")],
  });
  const extraDoc = { ...selectEstimates([mkRow("Q-EXTRA", quoteDoc("P-EXTRA", { updatedAt: EXPORTED_MS - 900 * DAY }))] as never)[0] };
  const withX = sliceExport(extraBase, { extraEstimates: [extraDoc as never] });
  ok(sliceIds(withX).join() === "Q-EXTRA,Q-NEW" && withX.selection.estimates.find((x) => x.id === "Q-EXTRA")?.extra === true && withX.selection.estimates.find((x) => x.id === "Q-NEW")?.extra === false,
    "handoff:recent: --extra-estimates are exempt from the window (a 900-day-old extra ships) and flagged as extras in the summary");
  ok(sliceCatalog(withX).map((p) => p.id).sort().join() === "P-EXTRA,P-Q-NEW", "handoff:recent: an extra's SKUs join the catalog; an unused part does not");
  const extraOnly = sliceExport(exportWith(clone(fixture), { quotes: [], parts: [part("P-EXTRA")] }), { extraEstimates: [extraDoc as never] });
  ok(sliceIds(extraOnly).join() === "Q-EXTRA", "handoff:recent: extras alone satisfy the 'at least one estimate' rule");

  // --- the catalog is exactly the union ---
  await catalogUnionChecks(ok, fixture);

  // --- handoff:photos and the slicer pick the same estimates ---
  for (const days of [1, 7, 28, 90, 500]) {
    let a: string[] | string, b: string[] | string;
    try { a = estimatesForExport(edge, days).estimates.map((x) => x.id); } catch (e) { a = (e as Error).name; }
    try { b = sliceExport(edge, { recentDays: days }).selection.estimates.map((x) => x.id); } catch (e) { b = (e as Error).name; }
    ok(JSON.stringify(a) === JSON.stringify(b), `handoff:recent: handoff:photos and handoff:slice pick identical estimates for --recent-days ${days} (${JSON.stringify(a)})`);
  }
  ok(sliceExport(edge, { recentDays: 7 }).counts.estimates === 3, "handoff:recent: --recent-days reaches sliceExport (7 days → 3 estimates)");
  const picks = selectionForExport(edge, 1).scopeSkus.join();
  ok(picks === "P-Q-NOW" && selectionForExport(edge, 28).scopeSkus.includes("P-Q-AT") && !selectionForExport(edge, 28).scopeSkus.includes("P-Q-JUST-OUT") && selectionForExport(edge, 500).scopeSkus.includes("P-Q-OLD"),
    `handoff:recent: the photo scope follows --recent-days (1 day → ${picks})`);

  // --- the summary lines ---
  const lines = describeEstimateSelection(w, sliceExport(extraBase, { extraEstimates: [extraDoc as never] }).selection.estimates).join("\n");
  ok(/last 28 days \(2026-09-22 → 2026-10-20\)/.test(lines) && /Q-NEW .*Quote P-Q-NEW .*Alpha Schools .*updated 2026-10-19/.test(lines) && /Q-EXTRA .*\[--extra-estimates/.test(lines),
    "handoff:recent: the summary lists the window and each estimate's id, name, customer and updated date");
  const fx = sliceExport(clone(fixture));
  ok(fx.selection.estimates.map((x) => `${x.id}:${x.estNo}`).join() === "Q-G001:9001,Q-G002:9002,Q-G003:9003" && fx.selection.window.days === 28 && fx.selection.estimates[0].customer === "Alpha Schools",
    "handoff:recent: the slice result carries each bundled estimate's id, estNo, name, customer and updatedAt");
  const metaW: Record<string, unknown> = {};
  new Function("window", fx.files["data/meta.js"])(metaW);
  ok(JSON.stringify((metaW.PEAK_META as { window: unknown }).window) === JSON.stringify({ days: 28, from: "2026-09-22T00:00:00.000Z", to: EXPORTED }), "handoff:recent: data/meta.js records the window");

  // --- CLI: --recent-days parsing and exit codes ---
  const repo = process.cwd();
  const runCli = (args: string[]) => spawnSync("npx", ["tsx", "handoff/estimator/slice.ts", ...args], { cwd: repo, encoding: "utf8", timeout: 120_000 });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-recent-"));
  try {
    const stale = exportWith(clone(fixture), { quotes: [q("Q-OLD", { updatedAt: EXPORTED_MS - 90 * DAY }), q("Q-NEWER", { updatedAt: EXPORTED_MS - 40 * DAY })], parts: [part("P-Q-OLD"), part("P-Q-NEWER")] });
    const stalePath = path.join(tmp, "stale.json");
    fs.writeFileSync(stalePath, JSON.stringify(stale));
    const o1 = path.join(tmp, "o1");
    const c1 = runCli(["--in", stalePath, "--out", o1]);
    ok(c1.status === 1 && !fs.existsSync(o1) && /28 days/.test(c1.stderr) && /--recent-days/.test(c1.stderr), `handoff:recent: CLI — nothing in the default window exits 1, names the window and writes nothing (exit ${c1.status})`);
    const o2 = path.join(tmp, "o2");
    const c2 = runCli(["--in", stalePath, "--out", o2, "--recent-days", "60"]);
    ok(c2.status === 0 && fs.existsSync(path.join(o2, "estimates.js")) && /Q-NEWER/.test(c2.stdout) && !/Q-OLD /.test(c2.stdout) && /last 60 days/.test(c2.stdout),
      `handoff:recent: CLI — --recent-days 60 widens the window; the summary lists the bundled estimates (exit ${c2.status})`);
    ok(/catalog: 1 part\(s\)/.test(c2.stdout) && /estimate=1/.test(c2.stdout), `handoff:recent: CLI — the summary prints the catalog count and why (${(c2.stdout.match(/catalog: .*/) ?? [""])[0]})`);
    const o3 = path.join(tmp, "o3");
    const c3 = runCli(["--in", stalePath, "--out", o3, "--recent-days", "0"]);
    ok(c3.status === 2 && !fs.existsSync(o3) && /--recent-days/.test(c3.stderr), `handoff:recent: CLI — --recent-days 0 exits 2 (usage) and writes nothing (exit ${c3.status})`);
    const noAtPath = path.join(tmp, "noat.json");
    const noAtExp = clone(stale);
    delete (noAtExp.meta as Record<string, unknown>).exportedAt;
    fs.writeFileSync(noAtPath, JSON.stringify(noAtExp));
    const c4 = runCli(["--in", noAtPath, "--out", path.join(tmp, "o4")]);
    ok(c4.status === 2 && /exportedAt/.test(c4.stderr), `handoff:recent: CLI — an export without exportedAt exits 2 (exit ${c4.status})`);
    // handoff:photos takes the same flag
    const pd = path.join(tmp, "pimg");
    const p1 = await quiet(() => photosMain(["--in", stalePath, "--out", pd, "--dry-run"], {}));
    ok(p1.value === 1 && /28 days/.test(p1.err) && !fs.existsSync(pd), "handoff:photos: no estimate in the default window → exit 1, nothing written");
    const p2 = await quiet(() => photosMain(["--in", stalePath, "--out", pd, "--dry-run", "--recent-days", "60"], {}));
    ok(p2.value === 0 && /last 60 days/.test(p2.out) && /Q-NEWER/.test(p2.out) && !/Q-OLD /.test(p2.out) && /parts the sliced estimates and fixtures name: 1\b/.test(p2.out), "handoff:photos: --recent-days 60 --dry-run lists the window, the estimates and the narrowed part scope");
    ok((await quiet(() => photosMain(["--in", stalePath, "--out", pd, "--dry-run", "--recent-days", "x"], {}))).value === 2, "handoff:photos: a bad --recent-days exits 2");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The catalog is exactly: estimate SKUs ∪ every assembly's SKUs ∪ rule-blob SKUs ∪ fabric picker ∪ Labor ∪ rename stubs for those. */
async function catalogUnionChecks(ok: Ok, fixture: ExportV2) {
  const quotes = [
    mkRow("Q-A", quoteDoc("P-LINE", {
      spec: { sections: [
        { id: "s1", name: "Main", kind: "lighting", mfr: "", freightPct: 0, items: [
          { id: 1, sku: "P-LINE", desc: "line", qty: 1, unit: "ea", cost: 1, price: 2 },
          { id: 2, sku: "P-COMP-PARENT", desc: "assembly line", qty: 1, unit: "ea", cost: 1, price: 2, components: [{ sku: "P-COMP", label: "c", role: "x", qty: 1, unit: "ea", cost: 1, price: 2 }] },
          { id: 3, sku: "CUSTOM", desc: "custom", qty: 1, unit: "ea", cost: 1, price: 2, custom: true },
          { id: 4, sku: "OLD-LINE", desc: "an old sku", qty: 1, unit: "ea", cost: 1, price: 2 },
          { id: 5, sku: "CUSTOM", desc: "drape", qty: 1, unit: "ea", cost: 1, price: 2, curtain: true, curtainInputs: { name: "Main", fabricSku: "P-FABRIC-USED", fabricName: "Velour" } },
          { id: 6, sku: "OLD-CHAIN-1", desc: "chain", qty: 1, unit: "ea", cost: 1, price: 2 },
        ] },
        { id: "s2", name: "Alt", kind: "rigging", mfr: "", freightPct: 0, alternate: true, items: [{ id: 1, sku: "P-ALT", desc: "alt", qty: 1, unit: "ea", cost: 1, price: 2 }] },
      ] },
      revisions: [{ rev: 1, at: 1, by: "x", reason: "sent", spec: { sections: [{ id: "s1", items: [{ id: 1, sku: "P-REV", qty: 1 }] }] } }],
    })),
    // an out-of-window quote: its parts must NOT ship
    mkRow("Q-OLD", quoteDoc("P-OLD-ONLY", { updatedAt: EXPORTED_MS - 200 * DAY })),
    // a Grid quote in the window: not an Estimator quote, its part must not ship
    mkRow("Q-GRID", quoteDoc("P-GRID-ONLY", { source: "grid" })),
  ];
  const fixtures = [
    mkRow("fa-1", { id: "fa-1", kind: "fixture", label: "Spot", lightEngineSku: "P-ENGINE", lensSku: "P-LENS", lines: [{ sku: "P-MEMBER", qty: 1 }], parts: [{ sku: "P-PARTS" }] }),
    mkRow("fa-rack", { id: "fa-rack", kind: "rack", label: "Rack", rack: { placements: [{ sku: "P-RACKED", kind: "device" }, { kind: "reserved" }] } }),
    mkRow("fa-gone", { id: "fa-gone", kind: "fixture", lines: [{ sku: "P-DELETED-ASM" }] }, true),
  ];
  const blobs = [
    { id: "track_series", data: { "adc-1": { parts: { track: { sku: "P-TRACK" }, splice: { sku: "P-SPLICE" }, carrier: { sku: "" } }, sticks: [{ lengthFt: 10, sku: "P-STICK-10" }, { lengthFt: 12, sku: "P-STICK-12" }] } } },
    { id: "curtain_mount_hardware", data: { rows: [{ sku: "P-MOUNT", qty: 1 }] } },
    { id: "system_categories", data: { categories: [{ id: "c1", name: "Controls", items: [{ sku: "P-TYPICAL", qty: 2 }] }] } },
    { id: "rack_defaults", data: { blankSku: "P-BLANK", ventSku: "P-VENT" } },
    { id: "pricing_rules", data: { tiers: { A: 0.3 } } },
    { id: "assist_secrets", data: { sku: "P-NOT-SHIPPED-BLOB" } }, // not a shipped blob (BLOB_IDS): its SKUs never count
  ];
  const parts = [
    ...["P-LINE", "P-COMP-PARENT", "P-COMP", "P-ALT", "P-REV", "P-ENGINE", "P-LENS", "P-MEMBER", "P-PARTS", "P-RACKED",
      "P-TRACK", "P-SPLICE", "P-STICK-10", "P-STICK-12", "P-MOUNT", "P-TYPICAL", "P-BLANK", "P-VENT", "P-FABRIC-USED",
      "NEW-LINE", "NEW-CHAIN",
      // not referenced by anything that ships:
      "P-OLD-ONLY", "P-GRID-ONLY", "P-DELETED-ASM", "P-NOT-SHIPPED-BLOB", "P-UNRELATED", "P-ALSO-UNRELATED"].map((s) => part(s)),
    part("P-FABRIC", { category: "Fabric", unit: "sqft", costPerSqft: 4.5 }),            // in the curtain picker (has a rate)
    part("P-SOFT-FAB", { category: "Theatrical/Soft Goods", unit: "sq ft", cost: 3 }),    // a Soft Goods fabric sold per sq ft (rate = its cost)
    part("P-FABRIC-NORATE", { category: "Fabric", unit: "sqft", cost: 0 }),             // no rate → the picker skips it
    part("P-SOFT-EACH", { category: "Theatrical/Soft Goods", unit: "ea", cost: 3 }),      // Soft Goods by the each is not a fabric
    part("LAB-RIG", { category: "Labor", unit: "hr" }), part("LAB-PM", { category: " Labor ", unit: "hr" }),
    mkRow("P-DELETED-PLAIN", { sku: "P-DELETED-PLAIN" }, true),
  ];
  // renames: OLD-LINE → NEW-LINE (the quote names the old SKU); OLD-CHAIN-1 → OLD-CHAIN-2 → NEW-CHAIN (a chain);
  // OLD-OF-LINE → P-LINE (the target ships on its own); OLD-OF-UNRELATED → P-UNRELATED (target does not ship); OLD-LOOP loops.
  const stubs = [
    mkRow("OLD-LINE", { sku: "OLD-LINE", renamedTo: "NEW-LINE" }, true),
    mkRow("OLD-CHAIN-1", { sku: "OLD-CHAIN-1", renamedTo: "OLD-CHAIN-2" }, true),
    mkRow("OLD-CHAIN-2", { sku: "OLD-CHAIN-2", renamedTo: "NEW-CHAIN" }, true),
    mkRow("OLD-OF-LINE", { sku: "OLD-OF-LINE", renamedTo: "P-LINE" }, true),
    mkRow("OLD-OF-UNRELATED", { sku: "OLD-OF-UNRELATED", renamedTo: "P-UNRELATED" }, true),
    mkRow("OLD-LOOP", { sku: "OLD-LOOP", renamedTo: "OLD-LOOP" }, true),
  ];
  const exp = exportWith(clone(fixture), { quotes, parts: [...parts, ...stubs], fixtures, blobs });
  const r = sliceExport(exp);
  const shipped = sliceCatalog(r);
  const liveIds = shipped.filter((p) => !("renamedTo" in p)).map((p) => String(p.id)).sort();
  const stubIds = shipped.filter((p) => "renamedTo" in p).map((p) => String(p.id)).sort();
  const wantLive = [
    "P-LINE", "P-COMP", "P-ALT", "P-REV", "P-FABRIC-USED", "NEW-LINE", "NEW-CHAIN",       // bundled estimate (components, alternates, revisions, curtain fabric, renamed lines)
    "P-COMP-PARENT",
    "P-ENGINE", "P-LENS", "P-MEMBER", "P-PARTS", "P-RACKED",                               // assemblies
    "P-TRACK", "P-SPLICE", "P-STICK-10", "P-STICK-12", "P-MOUNT", "P-TYPICAL", "P-BLANK", "P-VENT", // rules blobs
    "P-FABRIC", "P-SOFT-FAB", "LAB-RIG", "LAB-PM",                                         // the Estimator's fabric and labor pickers
  ].sort();
  ok(liveIds.join() === wantLive.join(), `handoff:catalog: the catalog is exactly the union (got ${liveIds.length} of ${wantLive.length}: missing ${wantLive.filter((x) => !liveIds.includes(x)).join()} extra ${liveIds.filter((x) => !wantLive.includes(x)).join()})`);
  ok(!liveIds.includes("P-OLD-ONLY") && !liveIds.includes("P-GRID-ONLY"), "handoff:catalog: a part on an old, out-of-window quote (or a Grid-built quote) is NOT shipped");
  ok(liveIds.includes("P-MEMBER") && liveIds.includes("P-RACKED") && liveIds.includes("P-ENGINE") && liveIds.includes("P-LENS") && liveIds.includes("P-PARTS"), "handoff:catalog: every assembly member ships — lines, parts, light engine / lens, rack placements");
  ok(!liveIds.includes("P-DELETED-ASM") && !liveIds.includes("P-NOT-SHIPPED-BLOB") && !liveIds.includes("P-UNRELATED") && !liveIds.includes("P-FABRIC-NORATE") && !liveIds.includes("P-SOFT-EACH"),
    "handoff:catalog: a deleted assembly, a blob the package does not ship, an unrelated part, a rate-less fabric and Soft Goods by the each stay out");
  ok(liveIds.includes("P-STICK-10") && liveIds.includes("P-STICK-12") && liveIds.includes("P-TRACK"), "handoff:catalog: a track_series stick and role part ships so the track configurator prices");
  // rename stubs: where the old SKU is named by an estimate / assembly / blob, or the target ships
  ok(stubIds.join() === ["OLD-CHAIN-1", "OLD-CHAIN-2", "OLD-LINE", "OLD-OF-LINE"].sort().join(),
    `handoff:catalog: rename stubs ship only where the old SKU is named or the target ships (got ${stubIds.join()})`);
  ok(!!shipped.find((p) => p.id === "OLD-LINE") && JSON.stringify(shipped.find((p) => p.id === "OLD-LINE")) === JSON.stringify({ id: "OLD-LINE", sku: "OLD-LINE", renamedTo: "NEW-LINE" }),
    "handoff:catalog: a stub is still { id, sku, renamedTo } only");
  ok(r.counts.catalog === wantLive.length && r.counts.catalogRetired === 4, "handoff:catalog: meta counts follow the selection");
  const by = r.selection.catalog.bySource;
  ok((by.estimate ?? 0) >= 7 && (by.assembly ?? 0) >= 5 && by["rule:track_series"] === 4 && by["rule:curtain_mount_hardware"] === 1 && by["rule:system_categories"] === 1 && by["rule:rack_defaults"] === 2 && by.fabric === 2 && by.labor === 2 && !("rule:assist_secrets" in by),
    `handoff:catalog: the per-source breakdown (${JSON.stringify(by)})`);
  ok(r.selection.catalog.live === wantLive.length && r.selection.catalog.retired === 4 && r.selection.catalog.unresolved >= 1, "handoff:catalog: the summary carries live / retired / unresolved counts");

  // the scope function on its own: the legacy settings.fixtureAssemblies backup counts as an assembly source
  const scope = selectCatalogScope({
    estimates: [], fixtures: [], blobs: {}, settings: { fixtureAssemblies: [{ id: "x", lightEngineSku: "P-LEGACY", options: { c: [{ sku: "P-LEGACY-OPT" }] } }] },
    catalog: [part("P-LEGACY"), part("P-LEGACY-OPT"), part("P-NO")] as never,
  });
  ok(scope.live.join() === "P-LEGACY,P-LEGACY-OPT" && scope.reasons.get("P-LEGACY")?.join() === "assembly", "handoff:catalog: settings.fixtureAssemblies (the legacy backup of the assemblies) is an assembly source");
  // a referenced SKU that is neither live nor a stub is reported, not shipped
  const sc2 = selectCatalogScope({ estimates: [{ spec: { sections: [{ items: [{ sku: "NOT-IN-BOOK" }] }] } }], fixtures: [], blobs: {}, settings: {}, catalog: [part("P-NO")] as never });
  ok(sc2.live.length === 0 && sc2.unresolved.join() === "NOT-IN-BOOK", "handoff:catalog: a SKU in no catalog row is reported as unresolved and ships nothing");

  // photos stay inside the shipped catalog: every photo-scope SKU that is a catalog part ships
  const photoScope = selectionForExport(exp).scopeSkus;
  const liveSet = new Set(liveIds);
  const bookIds = new Set(parts.filter((p) => !p.deleted).map((p) => p.id));
  ok(photoScope.length > 0 && photoScope.filter((s) => bookIds.has(s)).every((s) => liveSet.has(s)) && !photoScope.includes("P-OLD-ONLY") && !photoScope.includes("P-GRID-ONLY"),
    `handoff:catalog: the photo scope (${photoScope.length} SKUs) never names a part the catalog does not carry, and leaves out the old quote's parts`);

  // the shipped Estimator pickers still have what they read: fabrics + labor present in the slice
  const g: Record<string, unknown> = {};
  for (const f of Object.keys(r.files)) new Function("window", r.files[f])(g);
  ok(Array.isArray(g.PEAK_ESTIMATES) && (g.PEAK_ESTIMATES as unknown[]).length === 1 && r.hits.length === 0, "handoff:catalog: the union slice is one estimate and passes the final secret scan");
}

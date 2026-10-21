/**
 * handoff package checks (PR 2 Task 12) — the founder half of the Estimator handoff: the readable engine bundle
 * (app/estimating-core.js) has the source's export surface, loads through vm and require(), keeps the source's doc
 * comments and prices the golden fixtures byte for byte; every `PeakEstimatingCore.…` the founder docs cite exists in
 * it; the docs' generated blocks expand (and fail loudly on a bad marker); the README carries the Not-included list and
 * the user-visible caveats; the package audit, the deterministic zip, the parity checker and --full's feature
 * detection / sampling behave. test:specs → handoffPackageChecks(ok).
 */
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import JSZip from "jszip";
import { FIXTURE_EXPORT, FIXTURE_GOLDEN, goldenFileName, goldenFor, goldenJson, goldenWith, systemQuotesOf, type ExportFile } from "./estimating-golden";
import {
  auditPackage, auditProblems, ARTIFACT_PUBLISH_FILES, ARTIFACT_VERSION_FILES, fileCountWarnings, PRIVATE_BLOB_PREFIXES, buildEngineBundle, citedEnginePaths, engineAt, isJunkPath, keepDocComments, loadEngine, MAX_FILE_BYTES, parityProblems,
  REQUIRED_FILES, sliceSystemQuotes, SPEC_DOCS, writeGoldenFiles, writeZip, ZIP_ROOT, zipEntries, zipName,
} from "../handoff/estimator/package";
import { EXTRA_FIELD_NOTES, expandSpecMarkdown, fieldsTable, hasMarkers, onlyFields, typeFields, undocumentedFields } from "../handoff/estimator/spec-gen";
import { exportNames } from "../handoff/estimator/verify/parity";
import { estimateFeatures, FEATURES, sampleEstimates, type Feature } from "../handoff/estimator/verify/full";
import { classifyRequest, consoleErrorEntry, estimateUrl, fontsOk, isBenignConsoleError, newEstimateUrl, NO_UNREGISTERED_HOOK, SMOKE_ALLOWED_UNREGISTERED } from "../handoff/estimator/verify";
import { POPOUT_NOTICE, PRINT_FOOTER_TEXT } from "../handoff/estimator/ui/preview-routes";
import { RESET_BLOCKED_MESSAGE } from "../handoff/estimator/runtime/store";
import type { Ok } from "./test-inbox-org";

const ROOT = process.cwd();
const SPEC_SRC = path.join(ROOT, "handoff", "estimator", "spec");

export async function handoffPackageChecks(ok: Ok) {
  // --- keepDocComments: JSDoc openers only ---
  ok(keepDocComments("/** a */\nconst x = 1; /**/ /***/") === "/*! a */\nconst x = 1; /**/ /*!*/", "handoff:package: keepDocComments — turns `/** ` and `/***` openers into legal comments, leaves `/**/` alone");
  ok(keepDocComments("/**\n * doc\n */") === "/*!\n * doc\n */", "handoff:package: keepDocComments — a multi-line JSDoc opener");

  // --- the readable engine ---
  const { text, inputs } = await buildEngineBundle(ROOT);
  const core = loadEngine(text, "estimating-core.js");
  const source = (await import("@/lib/estimating-core")) as unknown as Record<string, unknown>;
  const isNs = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  const namespaces = new Set(Object.keys(source).filter((k) => isNs(source[k])));
  const want = exportNames(source, namespaces);
  const have = exportNames(core, namespaces);
  ok(want.length > 150 && have.join(",") === want.join(","), `handoff:package: the bundle exports exactly the source index.ts's names, namespaces included (${have.length} vs ${want.length})`);
  ok(inputs.every((f) => !/node_modules|src\/db\/|src\/lib\/stores\//.test(f)), "handoff:package: the engine bundle pulls in no package, store or database module");
  ok(text.includes("function totals(sections, taxRatePct)") && text.includes("EXACT port of the prototype logic"), "handoff:package: the bundle is unminified and keeps the source's doc comments");
  ok(text.startsWith("/*!") && text.includes("CONFIDENTIAL"), "handoff:package: the bundle opens with its confidential banner");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-package-"));
  try {
    const engFile = path.join(tmp, "estimating-core.js");
    fs.writeFileSync(engFile, text);
    const viaRequire = createRequire(engFile)(engFile) as Record<string, unknown>;
    ok(exportNames(viaRequire, namespaces).join(",") === have.join(","), "handoff:package: require() of the bundle returns the same engine (module.exports)");

    // golden parity on the committed fixtures, with the bundle's own functions
    const fixture = JSON.parse(fs.readFileSync(FIXTURE_EXPORT, "utf8")) as ExportFile;
    const fq = systemQuotesOf(fixture);
    ok(fq.length === 3 && fq.every((q) => goldenJson(goldenWith(core, q)) === goldenJson(goldenFor(q))), "handoff:package: goldenWith(bundle) equals goldenFor(source) on every golden fixture");
    ok(fq.every((q) => fs.readFileSync(path.join(FIXTURE_GOLDEN, goldenFileName(q.id)), "utf8") === goldenJson(goldenWith(core, q))), `handoff:package: the bundle reproduces ${FIXTURE_GOLDEN} byte for byte`);

    // parityProblems: identical, then a changed digit, a missing file and an extra file are each reported
    const pkg = path.join(tmp, "pkg");
    const estimates = (fixture.collections?.quotes ?? []).filter((r) => !r.deleted).map((r) => ({ ...(r.doc as Record<string, unknown>), id: r.id }));
    const sq = sliceSystemQuotes(estimates);
    ok(sq.map((q) => q.id).join(",") === fq.map((q) => q.id).join(","), "handoff:package: sliceSystemQuotes reads data/estimates.js rows as core:golden reads an export");
    ok(writeGoldenFiles(pkg, sq) === 3, "handoff:package: writeGoldenFiles writes one golden file per estimate");
    const gdir = path.join(pkg, "spec", "golden");
    ok(parityProblems(core, sq, gdir).length === 0, "handoff:package: parityProblems — the bundle against freshly written goldens is clean");
    const first = path.join(gdir, goldenFileName(sq[0].id));
    const orig = fs.readFileSync(first, "utf8");
    fs.writeFileSync(first, orig.replace(/"grand": (\d)/, (_m, d: string) => `"grand": ${(Number(d) + 1) % 10}`));
    ok(parityProblems(core, sq, gdir).some((p) => p.file === goldenFileName(sq[0].id) && /differ/.test(p.why)), "handoff:package: parityProblems — a changed grand total is reported");
    fs.writeFileSync(first, orig);
    fs.writeFileSync(path.join(gdir, "Q-EXTRA.json"), "{}");
    fs.rmSync(path.join(gdir, goldenFileName(sq[1].id)));
    const probs = parityProblems(core, sq, gdir);
    ok(probs.some((p) => p.file === "Q-EXTRA.json") && probs.some((p) => p.file === goldenFileName(sq[1].id) && p.why === "no golden file"), "handoff:package: parityProblems — an extra and a missing golden file are reported");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- every engine path the founder docs cite exists in the bundle ---
  for (const doc of ["pricing.md", "data-model.md"]) {
    const md = fs.readFileSync(path.join(SPEC_SRC, doc), "utf8");
    const cited = citedEnginePaths(md);
    const bad = cited.filter((p) => {
      const v = engineAt(core, p);
      const last = p.split(".").pop()!;
      return v === undefined || (/^[a-z]/.test(last) && typeof v !== "function");
    });
    ok(cited.length >= (doc === "pricing.md" ? 60 : 8) && bad.length === 0, `handoff:package: every PeakEstimatingCore.… ${doc} cites is defined in the bundle (functions are functions) — ${cited.length} cited${bad.length ? `; missing: ${bad.join(", ")}` : ""}`);
  }
  ok(engineAt(core, "totals") === core.totals && engineAt(core, "bonusRules.withBonusLines") !== undefined && engineAt(core, "nope.nothing") === undefined && engineAt(core, "totals.nope") === undefined, "handoff:package: engineAt resolves dotted paths and misses cleanly");
  ok(citedEnginePaths("`PeakEstimatingCore.a.b`, PeakEstimatingCore.c(x) and PeakEstimatingCore.a.b again").join(",") === "a.b,c", "handoff:package: citedEnginePaths dedupes and stops at a non-name character");

  // --- the docs' generated blocks ---
  for (const doc of SPEC_DOCS) {
    const raw = fs.readFileSync(path.join(SPEC_SRC, doc), "utf8");
    let md = "";
    let err = "";
    try {
      md = expandSpecMarkdown(raw, ROOT);
    } catch (e) {
      err = (e as Error).message;
    }
    ok(!err && !hasMarkers(md) && !md.includes("part-docs/") && md.includes("Confidential — Peak Systems Group"), `handoff:package: ${doc} expands with no marker left, no private path, and the confidential line${err ? ` — ${err}` : ""}`);
    ok(undocumentedFields(raw, ROOT).length === 0, `handoff:package: every field ${doc}'s tables print has a note (${undocumentedFields(raw, ROOT).join(", ")})`);
  }
  const dm = expandSpecMarkdown(fs.readFileSync(path.join(SPEC_SRC, "data-model.md"), "utf8"), ROOT);
  ok(["`curtainTrackKey`", "`alternate`", "`rackId`", "`bonus`", "`estSuffix`", "`revisions`", "`approvedAgainst`", "`reason`"].every((f) => dm.includes(f)), "handoff:package: data-model.md's tables carry the line, system, quote, review and revision fields");
  const ports = expandSpecMarkdown(fs.readFileSync(path.join(SPEC_SRC, "ports.md"), "utf8"), ROOT);
  ok(["### `users`", "### `customers`", "### `numbering`", "### `email`", "### `onWon`", "### `clock`", "nextEstNo", "travelFor(", "### `nextEstNoFrom()`"].every((s) => ports.includes(s)), "handoff:package: ports.md lists all six ports, their members and the customer rules");
  let threw = "";
  try {
    expandSpecMarkdown("<!-- @fields src/lib/estimating-core/types.ts NoSuchType -->", ROOT);
  } catch (e) {
    threw = (e as Error).message;
  }
  ok(/NoSuchType/.test(threw), "handoff:package: a marker naming an unknown type fails the expansion");
  threw = "";
  try {
    onlyFields(typeFields(ROOT, "src/lib/estimating-core/types.ts", "SpecMob"), ["type", "notAField"], "SpecMob");
  } catch (e) {
    threw = (e as Error).message;
  }
  ok(/notAField/.test(threw) && !("notAField" in EXTRA_FIELD_NOTES), "handoff:package: an allow-listed field the type lacks, with no note, fails");
  ok(fieldsTable([{ name: "a", optional: true, type: "string | null", doc: "x | y" }]).includes("| `a` (optional) | `string \\| null` | x \\| y |"), "handoff:package: fieldsTable escapes pipes inside cells");

  // --- README: the Not-included list and every user-visible caveat ---
  const readme = fs.readFileSync(path.join(SPEC_SRC, "README.md"), "utf8");
  const mustSay: Array<[string, string]> = [
    ["## Not included", "a Not included section"],
    ["service quotes (flame test, repair, inspection, rental, consulting)", "service quotes"],
    ["the customer portal", "portal"], ["the Grid system designer", "Grid"], ["the Specs builder", "Specs"], ["Gmail / Inbox", "Gmail / Inbox"],
    ["Assist / Ask AI", "Assist"], ["tasks, morning triage and the calendar", "tasks"], ["install projects", "projects"], ["the Daylite import", "Daylite import"],
    ["Double-click `index.html`", "how to open it"], ["Chrome, Edge and Safari", "browsers"],
    ["the last save\n  wins", "cross-window: last write wins"], ["until reloaded", "cross-window: reload to see changes"],
    [RESET_BLOCKED_MESSAGE, "Reset needs other windows closed (the dialog's own text)"],
    [PRINT_FOOTER_TEXT, "the print footer (its own text)"], ["Pop-out windows", "pop-outs"], ["Not\n  included in the prototype", "Datasheets / Drawings"],
    ["unique within one window", "numbers unique per window"], ["Product photos", "photos only for bundled parts"],
    ["Print / Save as PDF", "PDF via Print"], ["Sent (simulated)", "send is simulated"], ["Would create install project for", "won is simulated"],
    ["through those same seams", "the founder's own data comes through the ports"], ["Changes won't be saved in this window", "no-IndexedDB notice"],
  ];
  const flat = (s: string) => s.replace(/\s+/g, " ");
  const missingSay = mustSay.filter(([t]) => !flat(readme).includes(flat(t))).map(([, why]) => why);
  ok(missingSay.length === 0, `handoff:package: README says everything the founder must know (${missingSay.join("; ") || "all present"})`);
  ok(POPOUT_NOTICE.startsWith("Pop-out windows"), "handoff:package: the README's pop-out wording matches the notice");

  // --- the package audit and the zip ---
  const t2 = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-zip-"));
  try {
    const pkg = path.join(t2, "pkg");
    for (const f of REQUIRED_FILES) {
      fs.mkdirSync(path.dirname(path.join(pkg, f)), { recursive: true });
      fs.writeFileSync(path.join(pkg, f), f === "CONFIDENTIAL.txt" ? "CONFIDENTIAL" : `// ${f}\n`);
    }
    fs.mkdirSync(path.join(pkg, "images"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "images", "a.webp"), Buffer.from([1, 2, 3]));
    fs.writeFileSync(path.join(pkg, ".DS_Store"), "junk");
    fs.writeFileSync(path.join(pkg, "images", ".DS_Store"), "junk");
    const a0 = auditPackage(pkg);
    ok(a0.ok && a0.junk.length === 2 && a0.files.every((f) => !isJunkPath(f.file)), "handoff:package: auditPackage — a complete package passes; .DS_Store is junk, never counted");
    const zipA = path.join(t2, "a.zip");
    const zipB = path.join(t2, "b.zip");
    const za = await writeZip(pkg, zipA);
    await writeZip(pkg, zipB);
    ok(fs.readFileSync(zipA).equals(fs.readFileSync(zipB)), "handoff:package: writeZip is deterministic (same package → same bytes)");
    const back = await JSZip.loadAsync(fs.readFileSync(zipA));
    const names = Object.keys(back.files);
    ok(ZIP_ROOT === "peak-estimator-handoff" && names.every((n) => n.startsWith("peak-estimator-handoff/")) && names[0] === "peak-estimator-handoff/CONFIDENTIAL.txt" && !names.some((n) => n.includes(".DS_Store")) && names.every((n) => !back.files[n].dir) && names.join("\n") === zipEntries(pkg).map(zipName).join("\n") && za.entries.join("\n") === names.join("\n"),
      `handoff:package: every zip entry sits under peak-estimator-handoff/ (CONFIDENTIAL.txt first), no junk, no folder entries, the folder's files in order (${names.slice(0, 3).join(", ")}…)`);
    ok(!names.includes("CONFIDENTIAL.txt") && names.filter((n) => n.endsWith("CONFIDENTIAL.txt")).length === 1, "handoff:package: nothing at the zip root — one CONFIDENTIAL.txt, inside the folder");
    ok((await back.file("peak-estimator-handoff/CONFIDENTIAL.txt")!.async("string")) === "CONFIDENTIAL", "handoff:package: zipped content round-trips");
    fs.writeFileSync(path.join(pkg, "data.js"), "x".repeat(10) + "part-docs/abc/def.webp");
    fs.writeFileSync(path.join(pkg, "big.bin"), Buffer.alloc(MAX_FILE_BYTES + 1));
    fs.rmSync(path.join(pkg, "spec", "pricing.md"));
    const a1 = auditPackage(pkg);
    fs.writeFileSync(path.join(pkg, "notes.txt"), "photo failed: blob path outside part-docs/<docId>/");
    ok(!a1.ok && a1.privatePaths.includes("data.js") && a1.oversize.includes("big.bin") && a1.missing.includes("spec/pricing.md"), "handoff:package: auditPackage flags a private Blob path, a file over 15,000,000 bytes and a missing doc");
    ok(!auditPackage(pkg).privatePaths.includes("notes.txt"), "handoff:package: auditPackage — the 'part-docs/<docId>/' failure text is not a private pathname");
    ok(a1.unexpected.includes("data.js") && a1.unexpected.includes("big.bin"), "handoff:package A5: auditPackage — a stray file outside the layout (data.js, big.bin) fails the audit");
    // clean the planted failures away, then plant one problem at a time on an otherwise good package
    for (const f of ["data.js", "big.bin", "notes.txt"]) fs.rmSync(path.join(pkg, f), { force: true });
    fs.writeFileSync(path.join(pkg, "spec", "pricing.md"), "// spec/pricing.md\n");
    ok(auditPackage(pkg).ok, "handoff:package A5: the package is clean again");
    const plant = (rel: string, body: string | Buffer) => {
      fs.mkdirSync(path.dirname(path.join(pkg, rel)), { recursive: true });
      fs.writeFileSync(path.join(pkg, rel), body);
      const a = auditPackage(pkg);
      fs.rmSync(path.join(pkg, rel));
      return a;
    };
    for (const prefix of PRIVATE_BLOB_PREFIXES) {
      const a = plant("data/estimates.js", `window.PEAK_ESTIMATES = [{"x":"${prefix}/Q-1/rev-1.pdf"}];`);
      ok(!a.ok && a.privatePaths.includes("data/estimates.js"), `handoff:package A5: a ${prefix}/<id>/… pathname in a data file fails the audit`);
    }
    for (const stray of ["notes.txt", "data/extra.js", "data/catalog-0.js", "spec/RUNBOOK.md.bak", "spec/golden/x.txt", "images/manifest.json.bak", "images/sub/a.webp", "spec/screenshots/a.jpg", "secrets/x.js"]) {
      const a = plant(stray, "x");
      ok(!a.ok && a.unexpected.includes(stray), `handoff:package A5: a stray ${stray} fails the audit (layout allow-list)`);
    }
    for (const fine of ["data/catalog-2.js", "data/photos.js", "images/PD-1.webp", "spec/golden/Q-1.json", "spec/screenshots/01-estimates.png", "app/assets/x-ABC.jpg"]) {
      const a = plant(fine, "x");
      ok(a.ok && a.unexpected.length === 0, `handoff:package A5: ${fine} is part of the layout`);
    }
    const tok = "gh" + "p_" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    for (const where of ["app/app.js", "spec/README.md", "index.html", "app/estimating-core.js"]) {
      const before = fs.readFileSync(path.join(pkg, where));
      fs.writeFileSync(path.join(pkg, where), before.toString() + `\n// ${tok}\n`);
      const a = auditPackage(pkg);
      fs.writeFileSync(path.join(pkg, where), before);
      ok(!a.ok && a.secrets.some((x) => x.file === where && x.rules.includes("github-token")), `handoff:package A5: a token in ${where} fails the audit (secret scan over every text file)`);
    }
    ok(isJunkPath("images/manifest.json") && plant("images/manifest.json", "{}").ok, "handoff:package A6: images/manifest.json is never shipped (junk: not audited, not zipped)");
    ok(fileCountWarnings(255).length === 0 && /one Artifact publish/.test(fileCountWarnings(256)[0] ?? "") && /^!!!/.test(fileCountWarnings(512)[0] ?? "") && ARTIFACT_PUBLISH_FILES === 255 && ARTIFACT_VERSION_FILES === 511,
      "handoff:package A5: file count — no warning ≤ 255, a warning past one publish (255), a loud one past one Artifact version (511)");
    {
      const many = path.join(pkg, "images");
      for (let i = 0; i < 260; i++) fs.writeFileSync(path.join(many, `F-${i}.webp`), "x");
      const a = auditPackage(pkg);
      ok(a.ok && a.fileCount > 255 && a.warnings.length === 1, `handoff:package A5: a 260-image package still passes, with the Artifact warning (${a.fileCount} files)`);
      for (let i = 0; i < 260; i++) fs.rmSync(path.join(many, `F-${i}.webp`));
    }
    ok(auditProblems(auditPackage(pkg)).length === 0, "handoff:package A5: auditProblems is empty for a clean package");
    fs.rmSync(path.join(pkg, "CONFIDENTIAL.txt"));
    let refused = false;
    try {
      await writeZip(pkg, path.join(t2, "c.zip"));
    } catch {
      refused = true;
    }
    ok(refused && !fs.existsSync(path.join(t2, "c.zip")), "handoff:package: writeZip refuses a package with no CONFIDENTIAL.txt");
  } finally {
    fs.rmSync(t2, { recursive: true, force: true });
  }

  // --- final review C19/C20/B10: the harness's pure helpers ---
  ok(!isBenignConsoleError("TypeError: x is undefined") && !isBenignConsoleError("Failed to load resource: net::ERR_FILE_NOT_FOUND", "file:///pkg/app/app.css") &&
    isBenignConsoleError("Failed to load resource: net::ERR_NAME_NOT_RESOLVED", "https://fonts.googleapis.com/css2?family=X") &&
    isBenignConsoleError("Failed to load resource: the server responded with a status of 404 (Not Found)", "http://127.0.0.1:5000/favicon.ico") &&
    !isBenignConsoleError("Failed to load resource: the server responded with a status of 404 (Not Found)", "http://127.0.0.1:5000/app/app.js"),
    "handoff:package C20: a console.error fails the run unless benign — only an unreachable Google Fonts request or the host's favicon");
  ok(consoleErrorEntry("Failed to load resource: 404", "http://h/x.js") === "[console.error] Failed to load resource: 404 (http://h/x.js)" && consoleErrorEntry("boom") === "[console.error] boom",
    "handoff:package C20: a console.error lands in the page errors as “[console.error] …” with its resource URL");
  ok(!SMOKE_ALLOWED_UNREGISTERED.includes(NO_UNREGISTERED_HOOK) && /could not run/.test(NO_UNREGISTERED_HOOK), "handoff:package C20: a page without the unregistered-call hook reports an entry no allow-list holds (the run fails)");
  ok(estimateUrl("http://127.0.0.1:9/index.html?v=1", "Q-1", "step=review") === "http://127.0.0.1:9/index.html?v=1&id=Q-1&step=review#/estimate/Q-1" &&
    estimateUrl("file:///p/index.html", "Q-1") === "file:///p/index.html?id=Q-1#/estimate/Q-1" && newEstimateUrl("http://h/index.html?v=1") === "http://h/index.html?v=1&new=1#/estimate/new",
    "handoff:package C19: estimate URLs keep a host's query string (?v=1&id=…)");
  ok(classifyRequest("http://127.0.0.1:9/app/app.js", "http://127.0.0.1:9") === "local" && classifyRequest("http://127.0.0.1:9/app/app.js", null) === "foreign" && classifyRequest("http://127.0.0.1:10/x", "http://127.0.0.1:9") === "foreign",
    "handoff:package C19: the --serve origin is local; any other http host is foreign");
  ok(fontsOk({ ui: '"Public Sans", "Public Sans", sans-serif', mono: '"IBM Plex Mono", monospace' }) && !fontsOk({ ui: "Times", mono: "monospace" }),
    "handoff:package B10: fontsOk wants Public Sans and IBM Plex Mono computed");
  {
    const html = fs.readFileSync("handoff/estimator/index.html", "utf8");
    const root = /<style>[\s\S]*?:root\s*\{([\s\S]*?)\}[\s\S]*?<\/style>/.exec(html)?.[1] ?? "";
    ok(/<html lang="en">/.test(html) && ["--accent:", "--accent-contrast:", "--font-public-sans:", "--font-plex-mono:"].every((v) => root.includes(v)),
      "handoff:package B10: index.html defines the font and accent variables in a :root rule, not on <html style>");
  }

  // --- --full: feature detection and the seeded sample ---
  const sec = (id: string, items: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({ id, name: id, kind: "materials", mfr: "", freightPct: 0, items, ...extra });
  const line = (id: number, extra: Record<string, unknown> = {}) => ({ id, sku: `S${id}`, desc: "", qty: 1, unit: "ea", cost: 10, price: 20, ...extra });
  const q = (id: string, sections: unknown[], extra: Record<string, unknown> = {}) => ({ id, status: "sent", source: "estimator", quoteType: "system", spec: { sections, ...extra } });
  const rules = {};
  const alt = q("Q-ALT", [sec("s1", [line(1)]), sec("s2", [line(1)], { groupId: "g-a" })], { groups: [{ id: "g-a", name: "Alt", alternate: true }] });
  const rack = q("Q-RACK", [sec("s1", [line(1, { fixture: true, rackId: "SA-1" })])]);
  const ct = q("Q-CT", [sec("s1", [line(1, { curtain: true, curtainTrackKey: "ct-1-x" }), line(2, { track: { seriesId: "a" }, curtainTrackKey: "ct-1-x" })])]);
  const ctOrphan = q("Q-CTO", [sec("s1", [line(1, { curtain: true, curtainTrackKey: "ct-1-x" }), line(2, { track: { seriesId: "a" }, curtainTrackKey: "ct-9-y" })])]);
  const bonusStored = q("Q-BON", [sec("s1", [line(1, { labor: true }), line(2, { bonus: "estimator" })])]);
  const draftLabor = { ...q("Q-DRAFT", [sec("s1", [line(1, { labor: true })])]), status: "draft" };
  const plain = q("Q-PLAIN", [sec("s1", [line(1)])]);
  const f = (x: typeof plain) => [...estimateFeatures(x, rules)].sort().join(",");
  ok(f(alt) === "alternate" && f(rack) === "rack" && f(ct) === "curtainTrack" && f(ctOrphan) === "" && f(bonusStored) === "bonus" && f(draftLabor) === "bonus" && f(plain) === "",
    `handoff:package: estimateFeatures — alternate (via its group), rack, a keyed curtain + track pair (not a mismatched key), stored bonus lines, bonus derived on a draft (${[alt, rack, ct, ctOrphan, bonusStored, draftLabor, plain].map(f).join(" | ")})`);
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `Q-${1000 + i}` }));
  const feats = new Map<string, Set<Feature>>([["Q-1007", new Set<Feature>(["rack"])], ["Q-1023", new Set<Feature>(["alternate", "bonus"])], ["Q-1029", new Set<Feature>(["curtainTrack"])]]);
  const fo = (x: { id: string }) => feats.get(x.id) ?? new Set<Feature>();
  const s1 = sampleEstimates(many, fo, 5);
  const s2 = sampleEstimates([...many].reverse(), fo, 5);
  ok(s1.length === 5 && s1.map((x) => x.id).join() === s2.map((x) => x.id).join() && ["Q-1007", "Q-1023", "Q-1029"].every((id) => s1.some((x) => x.id === id)), `handoff:package: sampleEstimates — n picks, one per feature first, the same whatever the input order (${s1.map((x) => x.id).join(",")})`);
  ok(sampleEstimates(many.slice(0, 4), fo, 20).length === 4 && FEATURES.length === 4, "handoff:package: sampleEstimates — fewer than n → all of them");
}

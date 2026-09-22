/**
 * Grid options — store-level scenario on a SCRATCH PGlite (Spec 1).
 * Run only via `npm run test:grid-options` (which sets PGLITE_PATH to a
 * mktemp dir). Never point this at .data/pglite.
 */
import assert from "node:assert/strict";
import { patchDoc } from "@/db/doc-store";
import {
  addOption,
  addPlacement,
  addRevision,
  addRoute,
  addSheet,
  createProject,
  getProject,
  removeOption,
  renameOption,
  renameProject,
  restoreRevision,
  setOptionQuote,
  setScopeInputs,
  setSheetCalibration,
  type GridProject,
} from "@/lib/stores/grid-projects";
import { DEFAULT_OPTION_ID, optionSlice } from "@/lib/design/grid-options";
import { manualScopeInputs } from "@/lib/design/grid-intake";
import { buildGridQuote } from "@/lib/design/grid-quote";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { getDb } from "@/db";
import { seedIfEmpty } from "@/db/seed-data";
import { upsert as upsertCatalogPart } from "@/lib/stores/catalog";
import { defaultAState } from "@/app/(app)/design/quick/engine";

async function main() {
  if (!process.env.PGLITE_PATH) throw new Error("Refusing to run without PGLITE_PATH (scratch db).");

  // getDb() also fires an un-awaited background auto-seed (src/db/index.ts);
  // awaiting it explicitly here — same call scripts/seed.ts makes — makes
  // the catalog/Grid-symbol fixtures the pricing checks below depend on
  // deterministic instead of a race against that background seed.
  await seedIfEmpty(await getDb());

  const p0 = await createProject({ name: "Options scenario", customer: "Test Co", customerId: null, by: "tester" });
  const project = (await getProject(p0.id))!;
  assert.equal(project.options?.length, 1, "a new project reads with exactly one option");
  assert.equal(project.options![0].id, DEFAULT_OPTION_ID, "the first option is opt-base");
  const base = project.options![0].id;

  const sheet = (await addSheet(project.id, { name: "Sheet", mime: "image/svg+xml", dataUrl: "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E", by: "tester" }))!;
  await setSheetCalibration(project.id, { docId: sheet.id, page: 1, scale: 10, unit: "ft", refLength: 10, by: "tester", at: Date.now() });

  // members stamped with the option they were painted into
  await addPlacement(project.id, { sheetId: sheet.id, page: 1, x: 0.2, y: 0.2, partId: "PART-A", optionId: base, by: "tester" });
  await addPlacement(project.id, { sheetId: sheet.id, page: 1, x: 0.4, y: 0.2, partId: "PART-B", optionId: base, by: "tester" });
  const afterPlace = (await getProject(project.id))!;
  const [pa, pb] = afterPlace.placements;
  assert.equal(pa.optionId, base, "addPlacement stamps optionId");
  await addRoute(project.id, { sheetId: sheet.id, page: 1, partId: "WIRE-1", points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }], aspect: 1, optionId: base, by: "tester", fromPlacementId: pa.id, toPlacementId: pb.id });

  // unknown option is refused
  const bad = await addPlacement(project.id, { sheetId: sheet.id, page: 1, x: 0.5, y: 0.5, partId: "PART-C", optionId: "opt-nope", by: "tester" });
  assert.equal(bad, null, "addPlacement refuses an unknown optionId");

  // add by copy
  const copyRes = await addOption(project.id, { name: "Better", copyFromOptionId: base, by: "tester" });
  assert.ok(copyRes.ok, "addOption by copy succeeds");
  const better = copyRes.ok ? copyRes.option.id : "";
  const p2 = (await getProject(project.id))!;
  const sBase = optionSlice(p2, base);
  const sBetter = optionSlice(p2, better);
  assert.equal(sBase.placements.length, 2, "source option keeps its 2 placements");
  assert.equal(sBetter.placements.length, 2, "copied option has 2 placements");
  assert.equal(sBetter.routes.length, 1, "copied option has the route");
  assert.notEqual(sBetter.placements[0].id, sBase.placements[0].id, "copied placements have new ids");
  const copiedRoute = sBetter.routes[0];
  assert.ok(sBetter.placements.some((x) => x.id === copiedRoute.fromPlacementId), "copied route endpoints point at copied placements");

  // add empty
  const emptyRes = await addOption(project.id, { name: "Best", by: "tester" });
  assert.ok(emptyRes.ok, "addOption (empty) succeeds");
  const best = emptyRes.ok ? emptyRes.option.id : "";
  assert.equal(optionSlice((await getProject(project.id))!, best).placements.length, 0, "an empty option has no members");

  // rename
  const ren = await renameOption(project.id, best, "  Premium ");
  assert.ok(ren.ok, "renameOption succeeds");
  assert.equal((await getProject(project.id))!.options!.find((o) => o.id === best)!.name, "Premium", "rename trims and persists");
  const renEmpty = await renameOption(project.id, best, "   ");
  assert.ok(!renEmpty.ok && renEmpty.reason === "empty-name", "rename refuses an empty name");
  const longName = "x".repeat(60);
  const renLong = await renameOption(project.id, best, longName);
  assert.ok(renLong.ok, "rename with a long name succeeds");
  assert.equal(
    (await getProject(project.id))!.options!.find((o) => o.id === best)!.name.length,
    40,
    "option name is capped at 40 characters"
  );

  // quote mirror
  await setOptionQuote(project.id, better, "Q-BETTER");
  let p3 = (await getProject(project.id))!;
  assert.equal(p3.options!.find((o) => o.id === better)!.quoteId, "Q-BETTER", "setOptionQuote stores on the option");
  assert.equal(p3.quoteId, null, "project.quoteId mirrors the FIRST option only (still null)");
  await setOptionQuote(project.id, base, "Q-BASE");
  p3 = (await getProject(project.id))!;
  assert.equal(p3.quoteId, "Q-BASE", "project.quoteId mirrors options[0].quoteId");

  // revisions carry options; restore brings them back
  const rev = (await addRevision(project.id, { by: "tester", reason: "manual", note: "three options" }))!;
  assert.equal(rev.options?.length, 3, "a revision snapshots the options list");
  const rm = await removeOption(project.id, best, "tester");
  assert.ok(rm.ok, "removeOption (non-last) succeeds");
  assert.equal((await getProject(project.id))!.options!.length, 2, "option removed");
  const restored = await restoreRevision(project.id, rev.rev, "tester");
  assert.ok(restored.ok, "restore succeeds");
  assert.equal((await getProject(project.id))!.options!.length, 3, "restore brings the removed option back");

  // restore keeps quote links CURRENT, not rolled back — quote links are
  // bookkeeping, not design state (D150 clarification, final review)
  await setOptionQuote(project.id, base, "Q-KEEP");
  const mintRev = (await addRevision(project.id, { by: "tester", reason: "manual", note: "before mint" }))!;
  await setOptionQuote(project.id, base, "Q-LATER");
  const restoredAfterMint = await restoreRevision(project.id, mintRev.rev, "tester");
  assert.ok(restoredAfterMint.ok, "restore-after-mint succeeds");
  const afterMintRestore = (await getProject(project.id))!;
  assert.equal(
    afterMintRestore.options!.find((o) => o.id === base)!.quoteId,
    "Q-LATER",
    "restore keeps an option's current quote link"
  );
  assert.equal(afterMintRestore.quoteId, "Q-LATER", "restore re-mirrors project.quoteId");

  // remove option deletes its members and refuses the last one
  const rm2 = await removeOption(project.id, better, "tester");
  assert.ok(rm2.ok && rm2.removedPlacements === 2 && rm2.removedRoutes === 1, "removeOption reports and deletes that option's members");
  const p4 = (await getProject(project.id))!;
  assert.equal(p4.placements.length, 2, "other options' placements survive");
  assert.equal(p4.placements.every((x) => x.optionId === base), true, "only the base option's placements remain");
  await removeOption(project.id, best, "tester");
  const last = await removeOption(project.id, base, "tester");
  assert.ok(!last.ok && last.reason === "last-option", "the last option cannot be removed");

  // deleting the FIRST option re-mirrors quoteId to the new first
  const extra = await addOption(project.id, { name: "Second", by: "tester" });
  const secondId = extra.ok ? extra.option.id : "";
  await setOptionQuote(project.id, secondId, "Q-SECOND");
  const rmFirst = await removeOption(project.id, base, "tester");
  assert.ok(rmFirst.ok, "removing the first option is allowed when another exists");
  assert.equal((await getProject(project.id))!.quoteId, "Q-SECOND", "quoteId mirror follows the new first option");

  // ---- per-option pricing (Task 4) ----
  // The demo catalog seed (src/db/seeds/catalog.ts) is Fabric + Labor rows
  // only — no priced devices — so listGridSymbols()'s first-touch derivation
  // would otherwise fall back to its zero-priced hardcoded fixtures. Add two
  // priced device parts before that first touch so the Grid symbol library
  // derives real priced symbols, the same way it does once a price book is
  // imported.
  await upsertCatalogPart({ sku: "TEST-GRID-DEV-A", desc: "Test Grid Device A", category: "Lighting", unit: "ea", list: 500, cost: 300 });
  await upsertCatalogPart({ sku: "TEST-GRID-DEV-B", desc: "Test Grid Device B", category: "Audio", unit: "ea", list: 800, cost: 480 });
  const catalog = await listCatalog();
  const pricingById = new Map(catalog.map((c) => [c.id, c]));
  const symbols = await listGridSymbols();
  const priced = symbols.filter((s) => s.pricingPartId && (pricingById.get(s.pricingPartId)?.list || 0) > 0);
  assert.ok(priced.length >= 2, "the seed catalog exposes at least two priced Grid symbols");
  const [symA, symB] = priced;

  const q0 = await createProject({ name: "Priced options", customer: "Test Co", customerId: null, by: "tester" });
  const qSheet = (await addSheet(q0.id, { name: "Sheet", mime: "image/svg+xml", dataUrl: "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E", by: "tester" }))!;
  const qBase = (await getProject(q0.id))!.options![0].id;
  const qGood = await addOption(q0.id, { name: "Good", by: "tester" });
  const goodId = qGood.ok ? qGood.option.id : "";
  await addPlacement(q0.id, { sheetId: qSheet.id, page: 1, x: 0.2, y: 0.2, partId: symA.id, optionId: qBase, by: "tester" });
  await addPlacement(q0.id, { sheetId: qSheet.id, page: 1, x: 0.3, y: 0.2, partId: symA.id, optionId: qBase, by: "tester" });
  await addPlacement(q0.id, { sheetId: qSheet.id, page: 1, x: 0.2, y: 0.4, partId: symB.id, optionId: goodId, by: "tester" });

  const qp = (await getProject(q0.id))!;
  const bBase = await buildGridQuote(qp, qBase);
  const bGood = await buildGridQuote(qp, goodId);
  assert.ok(bBase.ok && bGood.ok, "buildGridQuote prices both options");
  if (bBase.ok && bGood.ok) {
    assert.equal(bBase.build.lines.length, 1, "base option prices one grouped device line (2× symA)");
    assert.equal(bBase.build.lines[0].qty, 2, "base option line qty is 2");
    assert.equal(bGood.build.lines.length, 1, "good option prices its own single line");
    assert.equal(bGood.build.lines[0].partId, symB.id, "good option line is symB, not symA");
    assert.equal(bBase.build.spec.gridOptionId, qBase, "spec carries the option id");
    assert.ok(bBase.build.quoteName.endsWith(" · Design — The Grid design"), `quote name carries the option name when >1 option (got ${bBase.build.quoteName})`);
  }
  // (Fetch the project fresh after adding "Empty" — buildGridQuote's
  // hasOption check runs against the project object passed in, and the
  // stale `qp` snapshot from above doesn't know about this option yet.)
  const addedEmpty = await addOption(q0.id, { name: "Empty", by: "tester" });
  const emptyOptionId = addedEmpty.ok ? addedEmpty.option.id : "";
  const qpAfterEmpty = (await getProject(q0.id))!;
  const empty = await buildGridQuote(qpAfterEmpty, emptyOptionId);
  assert.ok(!empty.ok && /Place a device/.test(empty.error), "an option with no members refuses to price");

  // ---- intake side effects (Task 6): scope inputs + rename via the store ----
  const a = { ...defaultAState(0), venue: "school", width: 36, depth: 26, grid: 24, wing: 12, ph: 18 };
  await setScopeInputs(q0.id, manualScopeInputs(a));
  await renameProject(q0.id, "Main Hall — Northshore HS");
  const withScope = (await getProject(q0.id))!;
  assert.equal(withScope.scopeInputs?.venue, "school", "scopeInputs seeded from the intake dims");
  assert.equal(withScope.scopeInputs?.sys.controls, false, "non-trackable systems are off in seeded scopeInputs");
  assert.equal(withScope.name, "Main Hall — Northshore HS", "renameProject persists");

  // ---- restore of a pre-spec revision (no options key) collapses onto a
  // single default option (D150 clarification, final review). Put LAST:
  // it collapses `project`'s options down to one. ----
  const preSpec = (await getProject(project.id))!;
  const lastRev = preSpec.revisions!.at(-1)!;
  const preSpecRev = {
    ...lastRev,
    rev: lastRev.rev + 1,
    placements: lastRev.placements.map((pl) => {
      const rest = { ...pl };
      delete rest.optionId;
      return rest;
    }),
    routes: [],
  } as typeof lastRev;
  delete preSpecRev.options;
  await patchDoc<GridProject>("grid_projects", project.id, (d) => {
    d.revisions = [...(d.revisions || []), preSpecRev];
  });
  const preSpecRestore = await restoreRevision(project.id, preSpecRev.rev, "tester");
  assert.ok(preSpecRestore.ok, "restore of a hand-crafted pre-spec revision succeeds");
  const afterPreSpecRestore = (await getProject(project.id))!;
  assert.equal(
    afterPreSpecRestore.options!.length,
    1,
    "a pre-spec revision restores as a single default option holding every member"
  );
  assert.equal(
    afterPreSpecRestore.options![0].id,
    DEFAULT_OPTION_ID,
    "the collapsed option is the default option id"
  );
  assert.ok(
    afterPreSpecRestore.placements.every((pl) => pl.optionId === DEFAULT_OPTION_ID),
    "every placement lands on the default option"
  );

  console.log("PASS grid-options store scenario");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL grid-options store scenario");
    console.error(e);
    process.exit(1);
  });

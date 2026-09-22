/**
 * Grid options — store-level scenario on a SCRATCH PGlite (Spec 1).
 * Run only via `npm run test:grid-options` (which sets PGLITE_PATH to a
 * mktemp dir). Never point this at .data/pglite.
 */
import assert from "node:assert/strict";
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
  restoreRevision,
  setOptionQuote,
  setSheetCalibration,
} from "@/lib/stores/grid-projects";
import { DEFAULT_OPTION_ID, optionSlice } from "@/lib/design/grid-options";

async function main() {
  if (!process.env.PGLITE_PATH) throw new Error("Refusing to run without PGLITE_PATH (scratch db).");

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

  console.log("PASS grid-options store scenario");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL grid-options store scenario");
    console.error(e);
    process.exit(1);
  });

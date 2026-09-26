/**
 * Drawing-set print fixture (#GDS). Seeds ONE demo Grid project — a plan
 * sheet, two spaces, devices in several systems, a wire route, a RiserLink,
 * a level line, a conduit, riser notes, two revisions and set settings —
 * into a SCRATCH PGlite, prints the project id, and exits.
 *
 *   D=$(mktemp -d); env -u DATABASE_URL PGLITE_PATH=$D/pglite npx tsx scripts/fixture-grid-drawing-set.ts
 *
 * Refuses to run with DATABASE_URL set, without PGLITE_PATH, or against any
 * .data/ directory (the real dev book lives there). PGlite is single-process: this must exit
 * before a dev server opens the same datadir.
 */
import { getDb } from "@/db";
import { seedIfEmpty } from "@/db/seed-data";
import { isPerLengthUnit } from "@/lib/design/grid-bom";
import type { RiserOp } from "@/lib/design/grid-riser-doc";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import {
  addPlacements,
  addRevision,
  addRoute,
  addSheet,
  addSpace,
  createProject,
  getProject,
  saveGridIntake,
  setDrawingSet,
  setSheetCalibration,
} from "@/lib/stores/grid-projects";
import { addRiserLink, patchRiser } from "@/lib/stores/grid-riser";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1700" height="1100" viewBox="0 0 1700 1100">' +
  '<rect x="40" y="40" width="1620" height="1020" fill="#fff" stroke="#222" stroke-width="4"/>' +
  '<rect x="300" y="120" width="1100" height="380" fill="none" stroke="#555" stroke-width="3"/>' +
  '<text x="850" y="320" font-size="48" text-anchor="middle" fill="#777">STAGE</text>' +
  '<rect x="200" y="560" width="1300" height="440" fill="none" stroke="#555" stroke-width="3"/>' +
  '<text x="850" y="800" font-size="48" text-anchor="middle" fill="#777">HOUSE</text></svg>';

async function main() {
  if (process.env.DATABASE_URL) throw new Error("Refusing to run: DATABASE_URL is set — this fixture only ever writes a scratch PGlite (run it under `env -u DATABASE_URL`).");
  const dir = process.env.PGLITE_PATH || "";
  if (!dir || /(^|\/)\.data(\/|$)/.test(dir)) throw new Error("Refusing to run: set PGLITE_PATH to a scratch directory (never .data/).");
  await seedIfEmpty(await getDb());

  const by = "Fixture";
  const symbols = (await listGridSymbols(by)).filter((s) => s.kind !== "assembly");
  const catalog = await listCatalog();
  const scoped = (scope: string) => symbols.find((s) => s.scope === scope);
  const light = scoped("Lighting") || symbols[0];
  // A second lighting type, so L-101 carries L1 and L2 marks.
  const light2 = symbols.filter((s) => s.scope === "Lighting" && s.id !== light.id)[0] || light;
  const audio = scoped("Audio") || symbols[1] || symbols[0];
  const video = scoped("Video") || audio;
  if (!light || !audio || !video) throw new Error("The seeded Grid library is empty.");
  // Grid-library ids equal their pricing row's id (grid-catalog fromPricing).
  const cableId = catalog.find((p) => isPerLengthUnit(p.unit))?.id || "FIXTURE-CABLE";

  const p0 = await createProject({ name: "Drawing set fixture", customer: "Lakefront Performing Arts Center", customerId: null, by });
  await saveGridIntake(p0.id, {
    complete: true,
    measurementBased: false,
    mode: "manual",
    venueName: "Main Stage",
    locationName: "",
    address: "12 Shore Dr, Appleton, WI",
    notes: "",
  });
  const sheet = await addSheet(p0.id, { name: "Main floor", mime: "image/svg+xml", dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`, by });
  if (!sheet) throw new Error("addSheet failed");
  await setSheetCalibration(p0.id, { docId: sheet.id, page: 1, scale: 85, unit: "ft", refLength: 85, by, at: Date.now() });
  await addSpace(p0.id, { sheetId: sheet.id, page: 1, name: "Stage", points: [{ x: 0.176, y: 0.109 }, { x: 0.824, y: 0.109 }, { x: 0.824, y: 0.455 }, { x: 0.176, y: 0.455 }], by });
  await addSpace(p0.id, { sheetId: sheet.id, page: 1, name: "House", points: [{ x: 0.118, y: 0.509 }, { x: 0.882, y: 0.509 }, { x: 0.882, y: 0.909 }, { x: 0.118, y: 0.909 }], by });

  let p = await getProject(p0.id);
  if (!p) throw new Error("project vanished");
  const opt = p.options![0].id;
  await addPlacements(p0.id, {
    sheetId: sheet.id,
    page: 1,
    optionId: opt,
    by,
    items: [
      { x: 0.3, y: 0.2, partId: light.id },
      { x: 0.5, y: 0.2, partId: light.id },
      { x: 0.7, y: 0.2, partId: light.id },
      { x: 0.25, y: 0.6, partId: audio.id },
      { x: 0.75, y: 0.6, partId: audio.id },
      { x: 0.5, y: 0.85, partId: video.id },
      // A tight cluster (a symbol apart) — the label collision pass has to
      // keep every mark off its neighbours (final review I3).
      { x: 0.36, y: 0.33, partId: light2.id },
      { x: 0.41, y: 0.33, partId: light2.id },
      { x: 0.36, y: 0.39, partId: light.id },
      { x: 0.41, y: 0.39, partId: light2.id },
    ],
  });
  p = (await getProject(p0.id))!;
  const [l1, l2, , a1, , v1] = p.placements;
  await addRoute(p0.id, {
    sheetId: sheet.id,
    page: 1,
    partId: cableId,
    points: [{ x: l1.x, y: l1.y }, { x: l2.x, y: l2.y }],
    aspect: 1100 / 1700,
    optionId: opt,
    by,
    fromPlacementId: l1.id,
    toPlacementId: l2.id,
  });
  const link = await addRiserLink(p0.id, { optionId: opt, from: { kind: "placement", placementId: a1.id }, to: { kind: "placement", placementId: v1.id }, partId: cableId, lengthFt: 120, by });
  if (!link.ok) throw new Error(`addRiserLink: ${link.reason}`);
  const ops: RiserOp[] = [
    { op: "addLevel", label: "Stage level", elevation: "EL 100", y: 0.72 },
    { op: "addConduit", from: { kind: "space", spaceId: p.spaces![0].id }, to: { kind: "space", spaceId: p.spaces![1].id }, label: '1" EMT (by EC)' },
    { op: "addNote", text: "Verify all dimensions in the field." },
    { op: "addNote", text: "Conduit and back boxes by the electrical contractor." },
  ];
  for (const op of ops) {
    const r = await patchRiser(p0.id, opt, op);
    if (!r.ok) throw new Error(`patchRiser ${op.op}: ${r.reason}`);
  }
  await addRevision(p0.id, { by, note: "Schematic design" });
  await addRevision(p0.id, { by, reason: "quote", note: "" });
  await setDrawingSet(p0.id, { drawnBy: "SM", checkedBy: "JC", generalNotes: "Verify in field.\nAll work per NEC." });
  console.log(p0.id);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

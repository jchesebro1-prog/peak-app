/* #373 — pipe and lineset configurators. Pure checks run alone with
   `npx tsx scripts/test-rigging-config.ts`; riggingDbChecks runs only inside test:specs (scratch PGLITE_PATH). */
import type { Ok } from "./test-inbox-org";
import {
  isFootUnit, linesetTypeProblems, pipeTypeProblems, sanitizeLinesetType, sanitizeLinesetTypeBlob, sanitizePipeType, sanitizePipeTypeBlob,
  type LinesetType, type PipeType,
} from "../src/lib/rigging-config/types";
import { pipeQuantities } from "../src/lib/rigging-config/pipe";
import { defaultLinesPerSet, linesetQuantities } from "../src/lib/rigging-config/lineset";
import { isConfiguredLine } from "../src/lib/rigging-config/line";
import { rewriteLinesetTypes, rewritePipeTypes } from "../src/lib/catalog-rename/rewrite";
import type { ResolvedFixtureAssembly } from "../src/lib/fixture-assemblies";
import {
  curtainPipeDraft, curtainPipePrefill, followCurtainPipePrefill, freshLinesetDraft, freshPipeDraft, linesetBom, linesetConfigFromDraft, linesetDraftFromConfig, linesetLine,
  pipeBom, pipeConfigFromDraft, pipeDraftFromConfig, pipeLine, riggingCatalog, selectableTypes,
} from "../src/app/(app)/estimator/rigging-bom";

const PIPE: PipeType = {
  id: "sch40", name: "1-1/2\" Sch 40", manufacturer: "", sticks: [{ lengthFt: 10, sku: "P10" }, { lengthFt: 21, sku: "P21" }],
  spliceSku: "SPL", clampSku: "CLP", hangerSpacingFt: 10, active: true,
};
const LINESET: LinesetType = {
  id: "quarter", name: "1/4\" cable", manufacturer: "",
  parts: { cable: { kind: "part", sku: "GAC" }, handLine: { kind: "part", sku: "HL" }, termination: { kind: "part", sku: "TRM" }, chainWrap: { kind: "assembly", id: "SA-1" } },
  allowanceFt: 10, active: true,
};
const qtyOf = (rows: { role: string; qty: number }[], role: string) => rows.find((r) => r.role === role)?.qty ?? 0;

function engineChecks(ok: Ok) {
  // Spec test case: 40' run, 21' sticks, 10' spacing.
  const p = pipeQuantities({ typeId: "sch40", runFt: 40, qty: 1 }, PIPE);
  ok(!p.errors.length && qtyOf(p.rows, "stick") === 2 && qtyOf(p.rows, "splice") === 1 && qtyOf(p.rows, "clamp") === 5, "#373 pipe: 40' = 2 sticks, 1 splice, 5 clamps");
  ok(p.rows.find((r) => r.role === "stick")?.sku === "P21", "#373 pipe: 40' uses 21' sticks");
  const one = pipeQuantities({ typeId: "sch40", runFt: 15, qty: 1 }, PIPE);
  ok(qtyOf(one.rows, "stick") === 1 && qtyOf(one.rows, "splice") === 0 && one.rows.every((r) => r.qty > 0), "#373 pipe: a run that fits one stick has no splice row");
  ok(one.rows.find((r) => r.role === "stick")?.sku === "P21", "#373 pipe: 15' needs the 21' stick");
  ok(pipeQuantities({ typeId: "sch40", runFt: 8, qty: 1 }, PIPE).rows.find((r) => r.role === "stick")?.sku === "P10", "#373 pipe: 8' takes the shortest covering stick");
  const two = pipeQuantities({ typeId: "sch40", runFt: 40, qty: 2 }, PIPE);
  ok(qtyOf(two.rows, "stick") === 4 && qtyOf(two.rows, "splice") === 2 && qtyOf(two.rows, "clamp") === 10, "#373 pipe: quantity multiplies every row");
  ok(qtyOf(pipeQuantities({ typeId: "sch40", runFt: 40, qty: 1, hangerSpacingFt: 8 }, PIPE).rows, "clamp") === 6, "#373 pipe: a typed spacing overrides the type's");
  ok(pipeQuantities({ typeId: "sch40", runFt: NaN, qty: 1 }, PIPE).errors.length === 1, "#373 pipe: blank run is an error");
  ok(pipeQuantities({ typeId: "sch40", runFt: 2000, qty: 1 }, PIPE).errors.length === 1, "#373 pipe: run over the limit is an error");
  ok(pipeQuantities({ typeId: "sch40", runFt: 40, qty: 1.5 }, PIPE).errors.length === 1, "#373 pipe: fractional quantity is an error");
  ok(pipeQuantities({ typeId: "sch40", runFt: 40, qty: 1 }, { ...PIPE, sticks: [] }).errors[0].includes("Estimating Rules → Pipe types"), "#373 pipe: no sticks names the Rules screen");

  // Spec test case: 6 sets, 40' wide, 40' grid, 10' allowance.
  const l = linesetQuantities({ typeId: "quarter", sets: 6, widthFt: 40, gridHeightFt: 40 }, LINESET);
  ok(!l.errors.length && l.liftLines === 24, "#373 lineset: 24 lift lines");
  ok(qtyOf(l.rows, "cable") === 1680 && qtyOf(l.rows, "handLine") === 480 && qtyOf(l.rows, "termination") === 48 && qtyOf(l.rows, "chainWrap") === 24, "#373 lineset: 1,680' cable, 480' hand line, 48 terminations, 24 chain wraps");
  ok(defaultLinesPerSet(8) === 1 && defaultLinesPerSet(40) === 4 && defaultLinesPerSet(49.9) === 4, "#373 lineset: 1 line per 10' of width, rounded down, at least 1");
  const typed = linesetQuantities({ typeId: "quarter", sets: 1, widthFt: 40, gridHeightFt: 40, linesPerSet: 6, allowanceFt: 0 }, LINESET);
  ok(typed.liftLines === 6 && qtyOf(typed.rows, "cable") === 360, "#373 lineset: typed lines and a 0' allowance win over the defaults");
  ok(qtyOf(linesetQuantities({ typeId: "quarter", sets: 1, widthFt: 25, gridHeightFt: 30.5 }, LINESET).rows, "cable") === 106, "#373 lineset: fractional cable rounds up (2 × 53')");
  ok(linesetQuantities({ typeId: "quarter", sets: 0, widthFt: 40, gridHeightFt: 40 }, LINESET).errors.length === 1, "#373 lineset: 0 sets is an error");
  ok(linesetQuantities({ typeId: "quarter", sets: 301, widthFt: 40, gridHeightFt: 40 }, LINESET).errors.length === 1, "#373 lineset: 301 sets is an error");
  ok(linesetQuantities({ typeId: "quarter", sets: 1, widthFt: 0, gridHeightFt: 40 }, LINESET).errors.length === 1, "#373 lineset: 0 width is an error");
  ok(linesetQuantities({ typeId: "quarter", sets: 1, widthFt: 40, gridHeightFt: 501 }, LINESET).errors.length === 1, "#373 lineset: grid over 500' is an error");
  ok(linesetQuantities({ typeId: "quarter", sets: 1, widthFt: 40, gridHeightFt: 40, linesPerSet: 21 }, LINESET).errors.length === 1, "#373 lineset: 21 lines per set is an error");
  ok(linesetQuantities({ typeId: "quarter", sets: 1, widthFt: 40, gridHeightFt: 40, allowanceFt: 201 }, LINESET).errors.length === 1, "#373 lineset: allowance over 200' is an error");
}

function typeChecks(ok: Ok) {
  const clean = sanitizePipeType({ id: "BAD ID", name: "  A  pipe ", sticks: [{ lengthFt: "21", sku: " P21 " }, { lengthFt: 21, sku: "DUP" }, { lengthFt: 0, sku: "X" }, { lengthFt: 10, sku: "P10" }], clampSku: "C", hangerSpacingFt: "", active: true })!;
  ok(clean.id === "" && clean.name === "A pipe", "#373 sanitize: bad id dropped, name collapsed");
  ok(clean.sticks.map((s) => s.lengthFt).join() === "10,21" && clean.sticks[1].sku === "P21", "#373 sanitize: sticks sorted, first duplicate kept, bad rows dropped");
  ok(clean.hangerSpacingFt === 10 && clean.active === true, "#373 sanitize: blank spacing falls back to 10'; a complete type stays active");
  ok(sanitizePipeType({ name: "X", active: true })!.active === false, "#373 sanitize: an incomplete type can never be active");
  ok(pipeTypeProblems({ ...PIPE, spliceSku: undefined }).length === 0, "#373 activation: a splice isn't required");
  ok(pipeTypeProblems({ ...PIPE, clampSku: undefined }).length === 1, "#373 activation: a clamp is required");
  ok(pipeTypeProblems(PIPE, new Set(["P10", "CLP"])).length === 1, "#373 activation: a stick that left the catalog is a problem");
  ok(pipeTypeProblems(PIPE, new Set(["P10", "P21", "CLP"])).length === 0, "#373 activation: a dead splice doesn't block");

  const ls = sanitizeLinesetType({ name: "L", parts: { cable: { kind: "part", sku: " G " }, handLine: { kind: "assembly", id: "A" }, termination: { kind: "bogus" }, bogus: { kind: "part", sku: "X" } }, allowanceFt: "" })!;
  ok(ls.parts.cable?.kind === "part" && ls.parts.handLine?.kind === "assembly" && !ls.parts.termination && !("bogus" in ls.parts), "#373 sanitize: lineset sources cleaned");
  ok(ls.allowanceFt === 10, "#373 sanitize: blank allowance is 10'");
  ok(sanitizeLinesetType({ name: "L", allowanceFt: 0 })!.allowanceFt === 0, "#373 sanitize: a 0' allowance is kept");
  ok(linesetTypeProblems({ ...LINESET, parts: { cable: LINESET.parts.cable } }).length === 1, "#373 activation: all four lineset roles are required");
  ok(linesetTypeProblems(LINESET, { skus: new Set(["GAC", "HL", "TRM"]), assemblyIds: new Set(["SA-1"]) }).length === 0, "#373 activation: live lineset passes");
  ok(linesetTypeProblems(LINESET, { skus: new Set(["GAC", "HL", "TRM"]), assemblyIds: new Set() }).length === 1, "#373 activation: a non-hardware or deleted assembly is unmapped");

  const blob = sanitizePipeTypeBlob({ a: { ...PIPE }, gone: null, "BAD KEY": { ...PIPE }, unnamed: { sticks: [] } });
  ok(blob.length === 1 && blob[0].id === "a", "#373 blob: tombstones, bad keys and unnamed types are skipped; id = key");
  ok(sanitizeLinesetTypeBlob({ b: { ...LINESET } })[0].id === "b", "#373 blob: lineset id = key");

  ok(["ft", "FT", "foot", "Feet", " lf "].every(isFootUnit) && !isFootUnit("ea") && !isFootUnit("spool") && !isFootUnit(""), "#373 unit: foot spellings");
  ok(isConfiguredLine({ track: {} }) && isConfiguredLine({ rigging: {} }) && !isConfiguredLine({}), "#373 isConfiguredLine");
}

function renameChecks(ok: Ok) {
  const m = new Map([["P21", "Brand:P21"], ["CLP", "Brand:CLP"], ["GAC", "Brand:GAC"]]);
  const pipe = rewritePipeTypes({ a: { ...PIPE }, gone: null }, m) as Record<string, PipeType>;
  ok(pipe.a.sticks[1].sku === "Brand:P21" && pipe.a.clampSku === "Brand:CLP" && pipe.a.spliceSku === "SPL" && pipe.gone === null, "#373 rename: pipe sticks and clamp move; the rest stay");
  const ls = rewriteLinesetTypes({ b: { ...LINESET } }, m) as Record<string, LinesetType>;
  ok((ls.b.parts.cable as { sku: string }).sku === "Brand:GAC" && (ls.b.parts.chainWrap as { id: string }).id === "SA-1", "#373 rename: lineset part sources move; assembly ids don't");
  ok(rewritePipeTypes({ a: { ...PIPE } }, new Map()) === null && rewriteLinesetTypes({ b: { ...LINESET } }, new Map()) === null, "#373 rename: nothing moved is null");
}

/** Inside test:specs only — opens the scratch PGlite. */
export async function riggingDbChecks(ok: Ok) {
  const { deletePipeType, listLinesetTypes, listPipeTypes, saveLinesetType, savePipeType } = await import("../src/lib/stores/rigging-types");
  const blank = await savePipeType({ name: "" }, "t");
  ok(!blank.ok, "#373 store: a blank name is refused");
  const made = await savePipeType({ name: "Sch 40", sticks: [{ lengthFt: 21, sku: "NOT-IN-CATALOG" }], clampSku: "NOT-IN-CATALOG", hangerSpacingFt: 10, active: true }, "t");
  ok(!made.ok && made.error.includes("no longer in the catalog"), "#373 store: Active re-checks the live catalog");
  const off = await savePipeType({ name: "Sch 40", sticks: [{ lengthFt: 21, sku: "NOT-IN-CATALOG" }], hangerSpacingFt: 10 }, "t");
  ok(off.ok && off.type.id === "sch-40" && off.type.active === false, "#373 store: saved inactive with a slug id");
  const dup = await savePipeType({ name: "sch 40" }, "t");
  ok(!dup.ok, "#373 store: duplicate name refused");
  if (off.ok) {
    ok(await deletePipeType(off.type.id), "#373 store: delete");
    ok(!(await listPipeTypes()).some((t) => t.id === off.type.id), "#373 store: deleted type is gone");
    const again = await savePipeType({ name: "Sch 40" }, "t");
    ok(again.ok && again.type.id === "sch-40-2", "#373 store: a deleted id is never reused");
  }
  const ls = await saveLinesetType({ name: "1/4 cable", parts: { cable: { kind: "part", sku: "X" } }, allowanceFt: 0 }, "t");
  ok(ls.ok && (await listLinesetTypes())[0].allowanceFt === 0, "#373 store: lineset saved");
  const act = await saveLinesetType({ name: "Full", parts: { cable: { kind: "assembly", id: "NOPE" }, handLine: { kind: "part", sku: "X" }, termination: { kind: "part", sku: "X" }, chainWrap: { kind: "part", sku: "X" } }, active: true }, "t");
  ok(!act.ok, "#373 store: Active refuses a dead assembly and dead parts");
}

const part = (sku: string, cost: number, list = 0, unit = "ea") => ({ sku, desc: sku + " desc", cost, list, unit, mfr: "" });
const PARTS = { P10: part("P10", 50), P21: part("P21", 100), SPL: part("SPL", 20), CLP: part("CLP", 10), GAC: part("GAC", 1, 0, "ft"), HL: part("HL", 2, 0, "ft"), TRM: part("TRM", 5) };
const HW = (id: string, comps: Array<[string, number, boolean?]>, kind: "hardware" | "fixture" = "hardware") =>
  ({ id, name: id, kind, components: comps.map(([sku, defaultQty, found]) => ({ sku, label: sku + " label", role: "other", defaultQty, desc: sku, unit: "ea", cost: 3, list: 9, found: found ?? true })) }) as unknown as ResolvedFixtureAssembly;
const CAT = riggingCatalog(PARTS, [HW("SA-1", [["SWG", 2], ["THB", 1], ["OPT", 0]]), HW("FX-1", [["F", 1]], "fixture"), HW("BROKEN", [["DEAD", 1, false]])]);

function pricingChecks(ok: Ok) {
  // 2 × $100 + 1 × $20 + 5 × $10 = $270 cost; at 50 % markup, $405.
  const b = pipeBom({ typeId: "sch40", runFt: 40, qty: 1 }, PIPE, CAT, 0.5);
  ok(!b.errors.length && b.cost === 270 && b.price === 405, "#373 pipe price: tier seed on the parts' cost");
  ok(b.rows.map((r) => r.label).join() === "Pipe (21' stick),Splice sleeve,Hanging clamp", "#373 pipe rows named");
  ok(b.rows[0].ext === 300 && b.rows[0].price === 150, "#373 pipe row: unit sell and extended");
  ok(pipeBom({ typeId: "sch40", runFt: 40, qty: 1 }, { ...PIPE, spliceSku: undefined }, CAT, 0.5).errors[0].includes("Estimating Rules → Pipe types"), "#373 pipe: a needed unmapped splice blocks and names the screen");
  ok(!pipeBom({ typeId: "sch40", runFt: 15, qty: 1 }, { ...PIPE, spliceSku: undefined }, CAT, 0.5).errors.length, "#373 pipe: an unneeded unmapped splice doesn't block");
  const listed = riggingCatalog({ ...PARTS, CLP: part("CLP", 0, 25) }, []);
  ok(pipeBom({ typeId: "sch40", runFt: 15, qty: 1 }, PIPE, listed, 0.5).price === 225, "#373 pipe: a part with no cost sells at list");
  ok(pipeBom({ typeId: "x", runFt: 40, qty: 1 }, null, CAT, 0.5).errors[0].includes("no longer exists"), "#373 pipe: deleted type");
  ok(pipeBom({ typeId: "sch40", runFt: 40, qty: 1 }, { ...PIPE, sticks: [{ lengthFt: 21, sku: "FOOT" }] }, riggingCatalog({ ...PARTS, FOOT: part("FOOT", 5, 0, "ft") }, []), 0.5).warnings.length === 1, "#373 pipe: a foot-priced stick warns and doesn't block");

  const l = linesetBom({ typeId: "quarter", sets: 6, widthFt: 40, gridHeightFt: 40 }, LINESET, CAT, 0.5);
  ok(!l.errors.length, "#373 lineset: prices");
  // 24 chain wraps × (SWG 2, THB 1); OPT is an add-on and left out.
  const swg = l.rows.find((r) => r.sku === "SWG");
  const thb = l.rows.find((r) => r.sku === "THB");
  ok(swg?.qty === 48 && thb?.qty === 24 && !l.rows.some((r) => r.sku === "OPT"), "#373 lineset: assembly members multiply; add-ons left out");
  ok(swg?.label === "Chain wraps: SWG label", "#373 lineset: member row names the role and the member");
  ok(swg?.price === 4.5, "#373 lineset: members price at the tier on the assembly's cost, not its sell");
  // 1680×$1 + 480×$2 + 48×$5 + 72×$3 = $3,096.
  ok(l.cost === 3096 && l.price === 4644, "#373 lineset: line total");
  const asmType = (id: string): LinesetType => ({ ...LINESET, parts: { ...LINESET.parts, chainWrap: { kind: "assembly", id } } });
  ok(linesetBom({ typeId: "q", sets: 1, widthFt: 40, gridHeightFt: 40 }, asmType("GONE"), CAT, 0.5).errors[0].includes("Chain wraps"), "#373 lineset: a deleted assembly blocks by role");
  ok(linesetBom({ typeId: "q", sets: 1, widthFt: 40, gridHeightFt: 40 }, asmType("FX-1"), CAT, 0.5).errors.length === 1, "#373 lineset: a non-hardware assembly blocks");
  ok(linesetBom({ typeId: "q", sets: 1, widthFt: 40, gridHeightFt: 40 }, asmType("BROKEN"), CAT, 0.5).errors.length === 1, "#373 lineset: an assembly with a part gone from the catalog blocks");
  const spool = riggingCatalog({ ...PARTS, GAC: part("GAC", 300, 0, "spool") }, [HW("SA-1", [["SWG", 2]])]);
  ok(linesetBom({ typeId: "q", sets: 1, widthFt: 40, gridHeightFt: 40 }, LINESET, spool, 0.5).warnings.some((w) => w.includes("Aircraft cable")), "#373 lineset: non-foot cable warns");

  const line = pipeLine({ typeId: "sch40", runFt: 40, qty: 2, label: "Main drape pipe" }, PIPE, CAT, 0.5);
  ok(line.ok && line.item.sku === "PIP-SCH40" && line.item.qty === 1 && line.item.unit === "lot", "#373 pipe line: one lot");
  ok(line.ok && line.item.desc === "Main drape pipe — 1-1/2\" Sch 40, 40' run (2 pipes)", "#373 pipe line: description");
  ok(line.ok && line.item.rigging?.kind === "pipe" && line.item.components!.length === 3, "#373 pipe line: config and parts");
  ok(line.ok && line.item.components!.find((c) => c.sku === "CLP")?.role === "mount", "#373 pipe line: clamps are mounts");
  const ll = linesetLine({ typeId: "quarter", sets: 6, widthFt: 40, gridHeightFt: 40 }, LINESET, CAT, 0.5);
  ok(ll.ok && ll.item.sku === "LNS-QUARTER" && ll.item.desc === "Lineset hardware — 1/4\" cable: 6 sets, 24 lift lines", "#373 lineset line: description");

  const pd = freshPipeDraft([{ ...PIPE, active: false }, { ...PIPE, id: "on", active: true }]);
  ok(pd.typeId === "on" && pd.qty === "1", "#373 draft: fresh pipe takes the first active type");
  ok(selectableTypes([{ ...PIPE, active: false }], "sch40").length === 1 && selectableTypes([{ ...PIPE, active: false }]).length === 0, "#373 selectable: inactive only when it's the draft's own");
  const round = pipeConfigFromDraft(pipeDraftFromConfig({ typeId: "a", runFt: 12.5, qty: 3, hangerSpacingFt: 8, label: "L" }));
  ok(round.runFt === 12.5 && round.qty === 3 && round.hangerSpacingFt === 8 && round.label === "L", "#373 draft: pipe round trip");
  const blank = pipeConfigFromDraft({ typeId: "a", run: "", qty: "", hangerSpacing: "", label: " " });
  ok(Number.isNaN(blank.runFt) && blank.qty === 1 && blank.hangerSpacingFt === undefined && blank.label === undefined, "#373 draft: blanks");
  const lr = linesetConfigFromDraft(linesetDraftFromConfig({ typeId: "a", sets: 6, widthFt: 40, gridHeightFt: 30, linesPerSet: 5, allowanceFt: 0, label: "L" }));
  ok(lr.sets === 6 && lr.linesPerSet === 5 && lr.allowanceFt === 0 && lr.label === "L", "#373 draft: lineset round trip keeps a 0' allowance");
  const lb = linesetConfigFromDraft(freshLinesetDraft([]));
  ok(lb.linesPerSet === undefined && lb.allowanceFt === undefined, "#373 draft: blank lineset fields are defaults");

  const c = { name: "Main drape", qty: "2", width: "40" };
  ok(curtainPipePrefill(c).label === "Main drape pipe" && curtainPipePrefill(c).run === "40" && curtainPipePrefill(c).qty === "2", "#373 curtain: pre-fill");
  const prev = curtainPipePrefill(c);
  const d = { ...curtainPipeDraft(c, [{ ...PIPE, active: true }]), label: "Typed" };
  const next = followCurtainPipePrefill(d, prev, curtainPipePrefill({ ...c, width: "50" }));
  ok(next.run === "50" && next.label === "Typed", "#373 curtain: untouched fields follow; typed ones stay");
}

export async function riggingConfigChecks(ok: Ok) {
  engineChecks(ok);
  typeChecks(ok);
  renameChecks(ok);
  pricingChecks(ok);
}

if (process.argv[1]?.endsWith("test-rigging-config.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  riggingConfigChecks(okf).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}

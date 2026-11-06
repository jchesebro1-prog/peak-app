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

export async function riggingConfigChecks(ok: Ok) {
  engineChecks(ok);
  typeChecks(ok);
}

if (process.argv[1]?.endsWith("test-rigging-config.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  riggingConfigChecks(okf).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}

/* Assessments engine (#340) — the versioned definition. A meaning-changing edit (renamed key, removed
   option, changed type) bumps `version` and keeps the old one under defs/versions/; wording-only edits
   don't. Pure data: safe to import from client components. */
import type { AssessmentDef, ModuleDef, QuestionDef, ScopeCode, VisitTypeDef } from "./types";
import { PICK_LISTS } from "./picklists";
import { RULES } from "./rules";
import { CORE_SCOPE } from "./scopes/core";
import { FACILITY_SCOPE } from "./scopes/facility";
import { RIGGING_SCOPE } from "./scopes/rigging";
import { SOFT_GOODS_SCOPE } from "./scopes/soft-goods";
import { FIRE_SCOPE } from "./scopes/fire";
import { LIGHTING_SCOPE } from "./scopes/lighting";
import { AV_SCOPE } from "./scopes/av";
import { ACCESS_SCOPE } from "./scopes/access";
import { PROJECT_SCOPE } from "./scopes/project";

export type * from "./types";

/** Slice 1 ships the Condition assessment (the Manitowoc case) only. */
export const VISIT_TYPES: VisitTypeDef[] = [
  {
    key: "condition",
    title: "Condition assessment",
    scopes: [
      { code: "S0", on: true },
      { code: "S1", on: true },
      { code: "S2", on: true, depth: "screen" },
      { code: "S3", on: true },
      { code: "S4", on: true },
      { code: "S5", on: true },
      { code: "S6", on: true },
      { code: "S7", on: true },
      { code: "S8", on: false },
    ],
  },
];

export const ASSESSMENT_DEF: AssessmentDef = {
  version: 1,
  visitTypes: VISIT_TYPES,
  scopes: [CORE_SCOPE, FACILITY_SCOPE, RIGGING_SCOPE, SOFT_GOODS_SCOPE, FIRE_SCOPE, LIGHTING_SCOPE, AV_SCOPE, ACCESS_SCOPE, PROJECT_SCOPE],
  rules: RULES,
  pickLists: PICK_LISTS,
};

const BY_VERSION: Record<number, AssessmentDef> = { 1: ASSESSMENT_DEF };

/** The definition an assessment was captured with; an unknown version reads with the current one. */
export function getDef(version: number): AssessmentDef {
  return BY_VERSION[version] ?? ASSESSMENT_DEF;
}

export function allQuestions(def: AssessmentDef): Map<string, { q: QuestionDef; moduleId: string; scope: ScopeCode }> {
  const out = new Map<string, { q: QuestionDef; moduleId: string; scope: ScopeCode }>();
  for (const s of def.scopes) for (const m of s.modules) for (const q of m.questions) if (!out.has(q.key)) out.set(q.key, { q, moduleId: m.id, scope: s.code });
  return out;
}

export function allModules(def: AssessmentDef): Map<string, { m: ModuleDef; scope: ScopeCode }> {
  const out = new Map<string, { m: ModuleDef; scope: ScopeCode }>();
  for (const s of def.scopes) for (const m of s.modules) if (!out.has(m.id)) out.set(m.id, { m, scope: s.code });
  return out;
}

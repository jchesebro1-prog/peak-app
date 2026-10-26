// scripts/room-shape-renders.ts
/* #370: frozen-shape renders of every template at its intake defaults, for Jeff's review (and ours) —
   `npx tsx scripts/room-shape-renders.ts` writes docs/room-shape/renders/<venue>-<template>.svg. Pure; no DB. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freezeFromTemplate } from "../src/lib/design/room-shape/freeze";
import { roomShapeSvg } from "../src/lib/design/room-shape/svg";
import { gridIntakeDefaults } from "../src/lib/design/grid-intake";
import { VENUES, sizedDims } from "../src/app/(app)/design/quick/engine";

const CASES: Array<[string, string]> = [
  ["school", "proscenium@1"], ["gym", "gym-stage@1"], ["church", "church-traditional@1"], ["church", "church-contemporary@2"],
  ["blackbox", "blackbox@1"], ["concenter", "blackbox@1"], ["arena", "arena@1"],
];
const out = join(process.cwd(), "docs/room-shape/renders");
mkdirSync(out, { recursive: true });
for (const [key, tpl] of CASES) {
  const v = VENUES.find((x) => x.key === key)!;
  const shape = freezeFromTemplate({ ...gridIntakeDefaults(), venue: v.key, sys: { ...v.sys }, ...sizedDims(v, "large") }, tpl, { by: "renders", at: 0 });
  const file = join(out, `${key}-${tpl.replace("@", "-")}.svg`);
  writeFileSync(file, roomShapeSvg(shape).markup);
  console.log(file, shape.rooms.map((r) => `${r.name}:${r.kind}`).join(", "));
}

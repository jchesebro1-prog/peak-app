/**
 * @deprecated #210 — fixtures and systems live in src/lib/stores/fixtures.ts
 * (same `subassemblies` doc table). These names stay as aliases so an older
 * reader still compiles; the pre-#210 row shape is `LegacySubassembly` in
 * src/lib/fixtures-convert.ts.
 */
export type { FixtureRecord as FixtureSubassembly, FixtureRecord as Subassembly, FixtureOptionCategory } from "@/lib/fixture-assemblies";
export type { LegacyOption as FixtureCompatibleOption } from "@/lib/fixtures-convert";
export { listFixtures as list, getFixture as get, removeFixture as remove } from "./fixtures";

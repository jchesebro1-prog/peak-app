// Moved to src/lib/daylite/ids.ts on 2026-09-24 (D180 follow-up, Task 10) so
// code under src/ (which Next bundles) can import it without reaching into
// scripts/. This re-export keeps every scripts/ caller working unchanged.
// One source of truth — do not fork this file.
export * from "../src/lib/daylite/ids";

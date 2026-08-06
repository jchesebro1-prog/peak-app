import type { GridProject } from "@/lib/stores/grid-projects";

/**
 * Grid seed — one worked system design so the editor route has something
 * real to open. Added 2026-08-06 for punch #79: `design/grid/[id]` renders
 * a friendly "no longer exists" page (status 200) for an unknown id rather
 * than calling notFound(), so without a seeded record the route smoke test
 * would pass while never mounting GridEditor at all.
 *
 * Id is GRD-5001 — createProject()'s base is 5001 and nextPrefixedId()
 * returns base+1 for an empty collection, so seeding the floor itself keeps
 * the first minted design at GRD-5002 with no collision.
 *
 * Deliberately carries no sheets or placements: the plan background lives in
 * the separate grid_sheets collection as a base64 payload, and the editor
 * renders fine with an empty canvas. Seeding a fake image would add weight
 * for no coverage.
 */
export function gridProjectsSeed(): GridProject[] {
  const t = Date.now();
  return [
    {
      id: "GRD-5001",
      name: "Main Stage — rigging & audio layout",
      customer: "Lakefront Performing Arts Center",
      customerId: "lakefront",
      siteId: "st-lakefront-1",
      siteName: "Main Stage",
      sheetIds: [],
      placements: [],
      calibrations: [],
      spaces: [],
      routes: [],
      revisions: [],
      quoteId: null,
      createdBy: "Jeff Chesebro",
      createdAt: t,
      updatedAt: t,
    },
  ];
}

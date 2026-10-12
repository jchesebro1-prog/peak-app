/**
 * Grid notes #9 — where the baked Peak letterhead lives, in ONE place:
 * letterhead-server.ts reads BAKED_LETTERHEAD with fs at run time, and
 * next.config.ts ships BAKED_LETTERHEAD_TRACE_GLOB with every function (file
 * tracing can't see that read). No imports, so next.config.ts can import it.
 * The glob writes the `(app)` route-group segment as `*` (parentheses are
 * glob syntax); the harness checks the two stay in step.
 */
export const BAKED_LETTERHEAD = "src/app/(app)/flame-tests/letter/peak-letterhead.jpg";
export const BAKED_LETTERHEAD_TRACE_GLOB = "./src/app/*/flame-tests/letter/peak-letterhead.jpg";

/** Batch 6 (bug fix) — the id format Field Work mints on the device for a new
 *  punch-list task (`uid("tk-")` in field-work/controls.tsx: "tk-" + base36).
 *  Pure, client-safe; re-exported by stores/tasks. */
export const FIELD_TASK_ID_RE = /^tk-[a-z0-9]{1,16}$/;

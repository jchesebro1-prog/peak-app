/**
 * Pop-out windows — the page-level "unsaved work" hold (D912). Client module
 * state, no imports. A page with unsaved work (the Estimator, from its
 * `pdfDirty` / unsaved-new-estimate state) turns it on; while it is on, this
 * window does not answer "Open in main window" (the pop-out opens a tab
 * instead) and LiveSync skips its focus refresh. Change-driven refreshes
 * still run — `router.refresh()` keeps client state.
 */

let held = false;

export function setUnsavedHold(on: boolean): void {
  held = !!on;
}

export function hasUnsavedHold(): boolean {
  return held;
}

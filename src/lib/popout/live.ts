/**
 * Pop-out windows — pop-out mode + LiveSync decisions (spec §2, §5). Pure,
 * no imports — safe in the client bundle and in the root (server) layout.
 */

/** The root layout's inline <head> script. Runs synchronously before first
 *  paint: only reads window.name, only adds the `pk-pop` class. */
export const POP_HEAD_SCRIPT =
  'try{if((window.name||"").indexOf("peak-pop:")===0)document.documentElement.classList.add("pk-pop")}catch(e){}';

/** The class the head script puts on <html> in a pop-out window. */
export const POP_CLASS = "pk-pop";
/** The class LiveSync puts on <html> inside the Capacitor native shell. */
export const NATIVE_CLASS = "pk-native";

/** The pop-out header's title: the document title without the app suffix. */
export function popHeaderTitle(docTitle: string | null | undefined): string {
  const t = (docTitle || "").trim();
  const stripped = t.replace(/\s+[—–-]\s+Quartzite(-\d+)?$/, "").trim();
  return stripped || t || "Quartzite";
}

/** Duck-typed element for `isEditableTarget` (an Element in the browser). */
export type EditableLike = {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
} | null | undefined;

const NON_TEXT_INPUTS = new Set([
  "button", "submit", "reset", "checkbox", "radio", "file", "image", "color", "range", "hidden",
]);

/** True for a field a person types into: a text-like <input>, a <textarea>,
 *  or a contenteditable (TipTap, rich editors). Read-only/disabled are not. */
export function isEditableTarget(el: EditableLike): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName || "").toUpperCase();
  if (tag === "TEXTAREA") return !el.readOnly && !el.disabled;
  if (tag === "INPUT") {
    const type = (el.type || "text").toLowerCase();
    return !NON_TEXT_INPUTS.has(type) && !el.readOnly && !el.disabled;
  }
  return false;
}

/** The in-app path (`/x?y#z`) for an open-in-main URL, or null when it is
 *  not on this origin (never navigate the main window off-site). */
export function toAppPath(url: string, origin: string): string | null {
  try {
    const u = new URL(url, origin);
    if (u.origin !== origin) return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}

/** localStorage key: the main (non-pop-out) window focused most recently. */
export const MAIN_FOCUS_KEY = "peak-main-window";

/** Should this main window answer an open-in-main request? Only the main
 *  window focused most recently answers, so two open main tabs don't both
 *  navigate. No record (or an unreadable one) → every main window answers. */
export function shouldAnswerOpenInMain(myId: string, raw: string | null | undefined): boolean {
  if (!raw) return true;
  try {
    const rec = JSON.parse(raw) as { id?: unknown } | null;
    if (!rec || typeof rec.id !== "string" || !rec.id) return true;
    return rec.id === myId;
  } catch {
    return true;
  }
}

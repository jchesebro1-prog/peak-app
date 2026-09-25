import { redirect } from "next/navigation";

/**
 * Phase A ships the library; the Generated list is Phase B (the generator).
 * Pointing the nav entry at the screen that does something beats pointing it
 * at an empty placeholder — Phase B replaces this file.
 */
export default function SpecsIndex() {
  redirect("/design/specs/library");
}

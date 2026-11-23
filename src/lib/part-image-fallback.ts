/**
 * What shows where a part photo belongs when the part has none of its own
 * (spec 2026-10-02-manufacturer-images-placeholders-design.md). Pure; safe in
 * client components. The caller checks the part's own photo first.
 *
 * Portal chain:   allowance → custom-device → manufacturer image → contact-us (POR) → coming-soon
 * Document chain: allowance → custom-device → manufacturer image → nothing (prints full width)
 *
 * A fallback is never stored on a part and never counts as a photo.
 */

export type PlaceholderName = "allowance" | "custom-device" | "contact-us" | "coming-soon";

export const PLACEHOLDER_SRC: Record<PlaceholderName, string> = {
  allowance: "/placeholders/allowance.webp",
  "custom-device": "/placeholders/custom-device.webp",
  "contact-us": "/placeholders/contact-us.webp",
  "coming-soon": "/placeholders/coming-soon.webp",
};

export type ImageFallback = { kind: "image"; documentId: string; label: string } | { kind: "placeholder"; name: PlaceholderName };
export type FallbackInput = { allowance?: boolean; custom?: boolean; mfr?: string | null; por?: boolean };
/** Manufacturer name → its image document id, or null. */
export type MfrImageLookup = (mfr: string) => string | null;

export const CUSTOM_PARTS_CATEGORY = "Custom Parts";

function kindOrManufacturer(input: FallbackInput, mfrImage: MfrImageLookup): ImageFallback | null {
  if (input.allowance) return { kind: "placeholder", name: "allowance" };
  if (input.custom) return { kind: "placeholder", name: "custom-device" };
  const mfr = String(input.mfr ?? "").trim();
  const id = mfr ? mfrImage(mfr) : null;
  return id ? { kind: "image", documentId: id, label: mfr } : null;
}

export function documentFallback(input: FallbackInput, mfrImage: MfrImageLookup): ImageFallback | null {
  return kindOrManufacturer(input, mfrImage);
}


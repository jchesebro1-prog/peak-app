"use client";

import { createContext, useContext } from "react";
import type { ParagraphSaveResponse } from "@/app/(app)/estimator/narrative";
import type { KeyProductLibrary } from "@/app/(app)/estimator/use-key-product-library";
import type { PackageDocCtx } from "@/lib/package-doc/resolve";

/**
 * Estimator Phase 5 — what the node views read (live values for chips and the
 * price table, the per-sku library for product blocks). TipTap renders React
 * node views as portals inside <EditorContent>, so a provider around it
 * reaches every view and re-renders them when the quote changes.
 */
export type PackageDocEditorEnv = {
  ctx: PackageDocCtx;
  library: KeyProductLibrary;
  canWriteLibrary: boolean;
  /** saveProductParagraphAction + refresh of the library row (the caller owns both). */
  onSaveToProduct: (sku: string, text: string, expectUpdatedAt: number | null) => Promise<ParagraphSaveResponse>;
};

export const PackageDocEditorContext = createContext<PackageDocEditorEnv | null>(null);

export function usePackageDocEnv(): PackageDocEditorEnv | null {
  return useContext(PackageDocEditorContext);
}

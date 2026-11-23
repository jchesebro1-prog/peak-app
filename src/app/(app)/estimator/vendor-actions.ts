"use server";

import { requireUser } from "@/lib/session";
import { loadVendorCompanies } from "@/lib/vendor-quotes/panel-server";
import type { VendorsPanelResult } from "@/lib/vendor-quotes/vm";

/** The Vendors card's server half: the vendor companies (names). Never the raw vendor quotes (their data-URLs) —
    the card reads the live editor state for those. */
export async function vendorsPanelAction(quoteId: string): Promise<VendorsPanelResult> {
  await requireUser();
  if (typeof quoteId !== "string" || !quoteId) return { ok: false, error: "That estimate wasn't found." };
  try {
    return { ok: true, companies: await loadVendorCompanies(quoteId) };
  } catch (err) {
    console.error("[vendor-quotes] vendors panel failed", quoteId, err);
    return { ok: false, error: "Couldn't load the vendors. Try again." };
  }
}

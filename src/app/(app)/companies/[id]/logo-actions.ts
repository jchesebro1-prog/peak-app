"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getCompany } from "@/lib/identity/companies";
import { COMPANY_LOGO_COPY, COMPANY_LOGO_MAX_BYTES } from "@/lib/company-logo";
import { prepareCompanyLogo } from "@/lib/company-logo-server";
import { clearCompanyLogo, setCompanyLogo } from "@/lib/stores/company-logos";

/**
 * Grid notes #8 — upload / replace / remove a customer company's logo (the
 * datasheet book cover's top-right mark). Anyone signed in, the same as
 * editing the company (saveCustomerAction). The file arrives as FormData;
 * size and type are checked on the server from the bytes themselves.
 */

type LogoResult = { ok: true } | { ok: false; error: string };

export async function saveCompanyLogoAction(companyId: string, form: FormData): Promise<LogoResult> {
  const me = await requireUser();
  if (typeof companyId !== "string" || !(await getCompany(companyId))) return { ok: false, error: COMPANY_LOGO_COPY.noCompany };
  const file = form.get("file");
  if (!file || typeof file === "string") return { ok: false, error: COMPANY_LOGO_COPY.notImage };
  // Size before reading: an oversized part never becomes a buffer here.
  if (file.size > COMPANY_LOGO_MAX_BYTES) return { ok: false, error: COMPANY_LOGO_COPY.tooBig };
  const prepared = await prepareCompanyLogo(new Uint8Array(await file.arrayBuffer()), me.name);
  if (!prepared.ok) return prepared;
  await setCompanyLogo(companyId, prepared.logo);
  revalidatePath(`/companies/${encodeURIComponent(companyId)}`);
  return { ok: true };
}

export async function removeCompanyLogoAction(companyId: string): Promise<LogoResult> {
  const me = await requireUser();
  if (typeof companyId !== "string" || !(await getCompany(companyId))) return { ok: false, error: COMPANY_LOGO_COPY.noCompany };
  await clearCompanyLogo(companyId, me.name);
  revalidatePath(`/companies/${encodeURIComponent(companyId)}`);
  return { ok: true };
}

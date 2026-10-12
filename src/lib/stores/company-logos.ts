import { getBlob, setBlob } from "@/db/doc-store";
import { sanitizeCompanyLogo, type CompanyLogo } from "@/lib/company-logo";

/**
 * Grid notes #8 — one customer company's logo, a per-company settings-style
 * blob (`company_logo:<companyId>`, like the per-user `gridFavorites:<id>`
 * blobs) so the relational companies row needs no migration. A removed logo
 * is written as `{ dataUrl: null }` and reads back as none.
 */

export const COMPANY_LOGO_BLOB_PREFIX = "company_logo:";

export function companyLogoBlobId(companyId: string): string {
  return `${COMPANY_LOGO_BLOB_PREFIX}${companyId}`;
}

export async function getCompanyLogo(companyId: string | null | undefined): Promise<CompanyLogo | null> {
  if (!companyId) return null;
  return sanitizeCompanyLogo(await getBlob<Record<string, unknown>>(companyLogoBlobId(companyId), {}));
}

export async function setCompanyLogo(companyId: string, logo: CompanyLogo): Promise<void> {
  await setBlob(companyLogoBlobId(companyId), { ...logo });
}

export async function clearCompanyLogo(companyId: string, by: string, at: number = Date.now()): Promise<void> {
  await setBlob(companyLogoBlobId(companyId), { dataUrl: null, width: 0, height: 0, updatedAt: at, updatedBy: by });
}

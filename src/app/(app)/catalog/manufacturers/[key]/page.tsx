import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { blobEnabled } from "@/lib/blob";
import { mfrKey, priceBooks } from "@/lib/catalog-books";
import { canonicalKeyMap, groupKeys } from "@/lib/manufacturer-aliases";
import { manufacturerRows } from "@/lib/manufacturer-rows";
import { manufacturerPageVM } from "@/lib/manufacturer-page-vm";
import { newestList, claimOwnerByKey } from "@/lib/vendor-status";
import { getSettings } from "@/lib/settings";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listManufacturers } from "@/lib/stores/manufacturers";
import { allVendorProfiles, vendorCompanies } from "@/lib/stores/vendors";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { buildImageIndex } from "@/lib/part-docs/views";
import { allCompanies, getCompanies, getCompany } from "@/lib/identity/companies";
import { contactsForCompany, displayName, emailsForContacts, getContact, phonesForContacts } from "@/lib/identity/contacts";
import { sitesForCompany } from "@/lib/identity/sites";
import { loadManufacturerAnalytics } from "@/lib/manufacturer-analytics-load";
import ManufacturerClient from "./manufacturer-client";
import QuotedSection from "./quoted-section";

export const metadata = { title: "Manufacturer — Quartzite-6" };
export const dynamic = "force-dynamic";
// Image upload verifies and shrinks with sharp through the Part 1 actions — same ceiling as the list page.
export const maxDuration = 60;

/** Catalog → Manufacturers → one manufacturer (Manufacturer section Part 2). */
export default async function ManufacturerPage({ params }: { params: Promise<{ key: string }> }) {
  const user = await requireUser();
  const { key: rawKey } = await params;
  let decoded = rawKey;
  try {
    decoded = decodeURIComponent(rawKey);
  } catch {
    notFound();
  }
  const key = mfrKey(decoded);
  if (!key) notFound();

  const parts = await listCatalog();
  const [state, records, profiles, vendorCos, settings, companies] = await Promise.all([
    loadPartDocsState(parts),
    listManufacturers(),
    allVendorProfiles(),
    vendorCompanies(),
    getSettings(),
    allCompanies(),
  ]);

  // A merged-away spelling is the same manufacturer as its target.
  const canonical = canonicalKeyMap(records)(key);
  // Also normalises a hand-typed URL (/ETC, /Rose%20Brand) to the lowercase canonical key.
  if (rawKey !== canonical) redirect(`/catalog/manufacturers/${encodeURIComponent(canonical)}`);

  const images = buildImageIndex(state.documents, state.links);
  // The portal's own-photo rule: a non-hidden image whose document has a stored file.
  const ownPhoto = (sku: string) => (images.get(sku) ?? []).some((r) => !r.hidden && !!state.index.docsById.get(r.id)?.blobKey);

  const record = records.find((m) => m.key === canonical) ?? null;
  const group = groupKeys(records, canonical);
  const groupSet = new Set(group);

  const company = record?.companyId ? await getCompany(record.companyId) : null;
  const [sites, companyContacts] = await Promise.all([sitesForCompany(company?.id), contactsForCompany(company?.id)]);
  const contactIds = companyContacts.map((c) => c.id);
  const [emailsBy, phonesBy] = await Promise.all([emailsForContacts(contactIds), phonesForContacts(contactIds)]);

  const repContacts = (await Promise.all((record?.people ?? []).map(async (p) => ({ p, c: await getContact(p.contactId) })))).filter(
    (x): x is { p: { contactId: string; role: string }; c: NonNullable<typeof x.c> } => !!x.c
  );
  const repCompanies = await getCompanies([...new Set(repContacts.map((x) => x.c.homeCompanyId).filter((id): id is string => !!id))]);

  const vendorInfo = new Map(
    vendorCos.map((c) => {
      const p = profiles.find((x) => x.id === c.id);
      const pct = p?.discounts.percentOffList;
      const terms = [pct != null ? `${pct}% off list` : "", p?.discounts.terms ?? ""].filter(Boolean).join(" — ");
      return [c.id, { name: c.name, lastList: newestList(p?.priceLists), terms, manufacturers: p?.manufacturers ?? [] }] as const;
    })
  );

  const books = priceBooks(parts, settings, { limit: Infinity }).filter((b) => groupSet.has(b.key));
  // Oldest wins (the Catalog banner's rule); unknown until every part in the group is dated.
  const priceBookAt = books.length && books.every((b) => b.effectiveAt != null) ? Math.min(...books.map((b) => b.effectiveAt as number)) : null;

  const vm = manufacturerPageVM({
    key: canonical,
    records,
    parts,
    ownPhoto,
    vendorOwnerByKey: claimOwnerByKey(profiles),
    vendors: vendorInfo,
    company: company ? { id: company.id, name: company.name } : null,
    sites: sites.map((s) => ({ name: s.name || s.locationName || "", address: s.address ?? "", city: s.city ?? "", state: s.state ?? "" })),
    companyPeople: companyContacts.map((c) => ({
      id: c.id,
      name: displayName(c),
      title: c.title || "",
      email: emailsBy.get(c.id)?.[0]?.email || "",
      phone: phonesBy.get(c.id)?.[0]?.phone || "",
    })),
    reps: repContacts.map(({ p, c }) => ({ contactId: c.id, name: displayName(c), company: (c.homeCompanyId && repCompanies.get(c.homeCompanyId)?.name) || "", role: p.role, companyId: c.homeCompanyId && repCompanies.has(c.homeCompanyId) ? c.homeCompanyId : null })),
    priceBookAt,
  });
  if (!vm.catalog.parts && !record) notFound();

  // Quotes are read once here; the catalog and records already loaded are reused.
  const analytics = await loadManufacturerAnalytics(undefined, { parts, records });

  const mergeTargets = manufacturerRows(parts, ownPhoto, records)
    .filter((r) => r.key !== vm.key)
    .map((r) => ({ key: r.key, name: r.name }));

  return (
    <div className="pk-content" style={{ maxWidth: 980 }}>
      <Link href="/catalog/manufacturers" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Manufacturers</Link>
      {!blobEnabled() && (
        <div style={{ margin: "10px 0 0", padding: "10px 14px", borderRadius: 10, background: "#fdf3df", border: "1px solid #f3e0b5", color: "#9a6b12", fontSize: 12.5 }}>
          File storage isn&apos;t configured on this deployment (no BLOB_READ_WRITE_TOKEN) — image uploads will be refused.
        </div>
      )}
      <ManufacturerClient
        vm={vm}
        canEdit={can("create", user.roles)}
        mergeTargets={mergeTargets}
        companyOptions={companies.map((c) => ({ id: c.id, name: c.name, detail: [c.city, c.state].filter(Boolean).join(", ") }))}
        vendorOptions={vendorCos.map((c) => ({ id: c.id, name: c.name, detail: [c.city, c.state].filter(Boolean).join(", ") }))}
      />
      <QuotedSection metrics={analytics.byKey.get(vm.key) ?? null} shopWinRate={analytics.shopWinRate} />
    </div>
  );
}

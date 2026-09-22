import type { VendorProfile } from "@/lib/stores/vendors";

/**
 * #122 — vendor profile seed (dev demo data). One profile for the seeded
 * vendor company "rose-brand" (seeds/customers.ts), claiming the seeded
 * catalog's manufacturer. Relative dates, so a function like every seed.
 * The ledger entry is 3 weeks old and the seeded parts carry no pricedAt,
 * so the vendor reads "Newer list received" and the daily cron creates the
 * catalog owner's task — the flow Jeff asked for, visible on first boot.
 * Contact id follows the converter's deterministic `ct-${docId}-${n}`.
 * Already in normalized shape (newest-first ledger, trimmed strings).
 */
export function vendorProfilesSeed(): VendorProfile[] {
  const day = 86_400_000;
  const now = Date.now();
  return [
    {
      id: "rose-brand",
      manufacturers: ["Rose Brand"],
      priceLists: [
        { id: "pl-seed-rb-1", receivedAt: now - 21 * day, effectiveAt: now - 21 * day, note: "Dealer price list (seed)", loggedBy: "Jena Tolksdorf" },
      ],
      discounts: { note: "Dealer program", percentOffList: 35, terms: "Net 30, freight prepaid over $2,500" },
      registration: { program: "Project registration by email", url: "", accountNumber: "PSG-2041", notes: "Register before the bid date; 30-day protection." },
      contactRoles: { "ct-rose-brand-1": "Price lists, quotes, project registration" },
      createdAt: now - 21 * day,
      updatedAt: now - 21 * day,
    },
  ];
}

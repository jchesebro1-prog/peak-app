import { requireUser } from "@/lib/session";
import { all as allCustomers, type CustomerDoc } from "@/lib/stores/customers";
import { get as getQuote } from "@/lib/stores/quotes";
import { list as listItems, type EquipmentCategory } from "@/lib/stores/equipment-items";
import { list as listLocations } from "@/lib/stores/equipment-locations";
import { getSettings } from "@/lib/settings";
import { QuoteBuilder, type BuilderCustomer, type BuilderInitial } from "./controls";

export const metadata = { title: "Rental quote — Quartzite-6" };

/**
 * Rental quote builder — the auto-priced rental estimator (rental twin of
 * the repair quote screen at repairs/quote/page.tsx, the structural mirror).
 * Interactive live calculator, so the server component loads the customer
 * directory + the rentable equipment catalog + locations and hands them to
 * the QuoteBuilder client, which computes pricing live via the shared pure
 * `priceRental()` module (rather than inlining a copy, unlike the repair
 * builder's inlined repair-engine math — nothing here needs the doc-store).
 * Save/Approve re-price server-side in actions.ts — the store stays the
 * source of truth.
 *
 * Deep-linked as /rentals/quote?id=<quoteId> to edit, or
 * ?customer=<customerId> to start a new quote for a customer.
 */

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const CATEGORY_LABEL: Record<EquipmentCategory, string> = {
  speakers: "Speakers",
  monitors: "Monitors",
  lighting: "Lighting",
  consoles: "Consoles",
  "control-io": "Control/IO",
  other: "Other",
};
const CATEGORIES: EquipmentCategory[] = ["speakers", "monitors", "lighting", "consoles", "control-io", "other"];

/** "YYYY-MM-DD" for a date input, local calendar date — mirrors the
 *  iso()/isoDate() helpers already used across the scheduling screens
 *  (e.g. inspections/scheduling/page.tsx). */
function isoDate(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n: number) => (n < 10 ? "0" + n : "" + n);
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

/* rental quote subdoc shape (what actions.ts saves — exact shape
 * equipment-bookings.ts's createFromQuote reads) */
type RtLine = {
  itemId?: string;
  locationId?: string;
  qty?: number;
  startDate?: number;
  endDate?: number;
  rate?: number;
};
type RentalDoc = { lines?: RtLine[] } | null;

export default async function RentalQuotePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, sp, customerDocs, items, locations, settings] = await Promise.all([
    requireUser(),
    searchParams,
    allCustomers(),
    listItems(),
    listLocations(),
    getSettings(),
  ]);

  const editId = one(sp.id);
  const preCustomer = one(sp.customer);
  const saved = one(sp.saved) === "1";
  const approved = one(sp.approved) === "1";

  const customers: BuilderCustomer[] = customerDocs.map((c: CustomerDoc) => ({
    id: c.id,
    name: c.name,
    contacts: (c.contacts || []).map((ct) => ({
      name: ct.name,
      role: ct.role || "",
      email: ct.email || "",
      primary: !!ct.primary,
    })),
  }));

  let initial: BuilderInitial = {
    editingId: null,
    customerId: "",
    quoteName: "",
    contactSel: "",
    contactManual: "",
    startDate: "",
    endDate: "",
    lines: [],
    saved,
    approved,
    savedId: "",
  };

  const editQuote = editId ? await getQuote(editId) : null;
  if (editQuote && editQuote.quoteType === "rental") {
    const rd: RentalDoc = (editQuote.rental as RentalDoc) || {};
    const cid = editQuote.customerId || "";
    const cust = customers.find((c) => c.id === cid) || null;
    const qc = editQuote.contact as { name?: string } | null;
    let contactSel = "";
    let contactManual = "";
    if (qc && qc.name) {
      const known = (cust?.contacts || []).some((c) => c.name === qc.name);
      if (known) contactSel = qc.name;
      else {
        contactSel = "__other__";
        contactManual = qc.name;
      }
    }
    const linesRaw = (rd && rd.lines) || [];
    const wonAlready = editQuote.status === "won";
    initial = {
      editingId: editQuote.id,
      customerId: cid,
      quoteName: editQuote.name || "",
      contactSel,
      contactManual,
      startDate: linesRaw.length ? isoDate(linesRaw[0].startDate) : "",
      endDate: linesRaw.length ? isoDate(linesRaw[0].endDate) : "",
      lines: linesRaw.map((l) => ({
        itemId: l.itemId || "",
        locationId: l.locationId || "",
        qty: l.qty != null ? String(l.qty) : "1",
      })),
      saved,
      approved: approved || wonAlready,
      savedId: editQuote.id,
    };
  } else if (preCustomer) {
    const cust = customers.find((c) => c.id === preCustomer) || null;
    if (cust) {
      const primary = cust.contacts.find((c) => c.primary) || cust.contacts[0] || null;
      initial = {
        ...initial,
        customerId: cust.id,
        quoteName: cust.name + " — Rental",
        contactSel: primary ? primary.name : "",
        saved: false,
        approved: false,
      };
    }
  }

  return (
    <QuoteBuilder
      customers={customers}
      items={items
        .filter((i) => i.active)
        .map((i) => ({
          id: i.id,
          sku: i.sku,
          name: i.name,
          category: i.category,
          manufacturer: i.manufacturer || "",
          dayRate: i.dayRate,
          weekRate: i.weekRate,
          monthRate: i.monthRate,
        }))}
      locations={locations.map((l) => ({ id: l.id, name: l.name }))}
      categories={CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABEL[c] }))}
      initial={initial}
      me={user.name}
      accent={settings.accent || "#7b3f8a"}
    />
  );
}

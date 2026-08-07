import { requireUser } from "@/lib/session";
import { all as allCustomers, type CustomerDoc } from "@/lib/stores/customers";
import { travelForCustomerVenues } from "@/lib/stores/customers";
import { get as getQuote } from "@/lib/stores/quotes";
import { LEVELS, levelMeta } from "@/lib/stores/inspections";
import { getRates } from "@/lib/inspection-engine";
import { getSettings } from "@/lib/settings";
import { coordsOf } from "@/lib/geo";
import { QuoteBuilder, type BuilderCustomer, type BuilderInitial } from "./controls";
import { builderTiers } from "@/lib/pricing-tiers";

export const metadata = { title: "Inspection quote — Quartzite-6" };

/**
 * Inspection QUOTE builder — the auto-priced rigging-inspection estimator
 * (inspection twin of the flame-test quote screen). Interactive live
 * calculator, so the server component loads the customer directory + live
 * rates + offices and hands them to the QuoteBuilder client, which computes
 * pricing live (the pure inspection-engine math is inlined client-side;
 * Save/Approve recompute server-side in actions.ts — the store stays the
 * source of truth).
 *
 * Deep-linked as /inspections/quote?id=<quoteId> to edit, or
 * ?customer=<customerId>&level=<1|2> to start a new quote for a customer
 * (the renewals panel's "Start renewal" link).
 */

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/* inspection quote subdoc shape (what actions.ts saves) */
type InVenue = { id?: string | null; label?: string; lineSets?: number };
type InContact = { name?: string; role?: string; email?: string } | null;
type InspectionDoc = {
  level?: number;
  scope?: string;
  venues?: InVenue[];
  contact?: InContact;
} | null;

export default async function InspectionQuotePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, sp, customerDocs, rates, settings] = await Promise.all([
    requireUser(),
    searchParams,
    allCustomers(),
    getRates(),
    getSettings(),
  ]);

  const editId = one(sp.id);
  const preCustomer = one(sp.customer);
  const preLevel = levelMeta(one(sp.level) || "1").key;
  const saved = one(sp.saved) === "1";
  const approved = one(sp.approved) === "1";

  /* ---- serializable customer directory with per-venue coords + travel ---- */
  // Customer tier margins seed the builder's margin knob (item 11, D88).
  const tierInfo = await builderTiers(customerDocs.map((c: CustomerDoc) => c.id));
  /* Travel is NO LONGER resolved here per venue (punch #90). This built an
     estimate for every venue of every customer while rendering — thousands of
     concurrent geo queries against the real directory, enough to exhaust a
     serverless connection pool. The builder only ever reads the SELECTED
     customer's venues, so the pre-selected one is filled in below and the
     client fetches the rest through venueTravelAction. */
  const customers: BuilderCustomer[] = customerDocs.map((c: CustomerDoc) => ({
      id: c.id,
      name: c.name,
      locations: (c.locations || []).map((l) => {
          const coords = coordsOf(l);
          return {
            id: l.id || "",
            label: l.label || "Venue",
            city: l.city || "",
            state: l.state || "",
            primary: !!l.primary,
            coords: coords ? { lat: coords.lat, lng: coords.lng } : null,
            oneWayMiles: null as number | null,
            oneWayMin: null as number | null,
          };
      }),
      contacts: (c.contacts || []).map((ct) => ({
        name: ct.name,
        role: ct.role || "",
        email: ct.email || "",
        primary: !!ct.primary,
        tierMargin: tierInfo[c.id]?.byContact[ct.name] ?? null,
      })),
      tierMargin: tierInfo[c.id]?.margin ?? null,
  }));

  const offices = (Array.isArray(settings.offices) ? settings.offices : []).map((o) => ({
    name: o.name || "",
    lat: o.lat,
    lng: o.lng,
  }));

  /* ---- initial builder state (edit / preselected customer) ---- */
  let initial: BuilderInitial = {
    editingId: null,
    customerId: "",
    quoteName: "",
    venueSel: {},
    contactSel: "",
    contactManual: "",
    level: preLevel,
    notes: "",
    saved,
    approved,
    savedId: "",
  };

  const editQuote = editId ? await getQuote(editId) : null;
  if (editQuote && editQuote.quoteType === "inspection") {
    const insp: InspectionDoc = (editQuote.inspection as InspectionDoc) || {};
    const cid = editQuote.customerId || "";
    const cust = customers.find((c) => c.id === cid) || null;
    const venueSel: BuilderInitial["venueSel"] = {};
    ((insp && insp.venues) || []).forEach((v) => {
      if (v.id)
        venueSel[v.id] = {
          on: true,
          lineSets: v.lineSets != null && v.lineSets !== 0 ? String(v.lineSets) : "",
        };
    });
    const qc = (editQuote.contact as InContact) || (insp && insp.contact) || null;
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
    const wonAlready = editQuote.status === "won";
    initial = {
      editingId: editQuote.id,
      customerId: cid,
      quoteName: editQuote.name || "",
      venueSel,
      contactSel,
      contactManual,
      level: levelMeta(insp && insp.level).key,
      notes: (insp && insp.scope) || "",
      saved,
      approved: approved || wonAlready,
      savedId: editQuote.id,
    };
  } else if (preCustomer) {
    const cust = customers.find((c) => c.id === preCustomer) || null;
    if (cust) {
      const locs = cust.locations;
      const venueSel: BuilderInitial["venueSel"] = {};
      locs.forEach((l) => {
        venueSel[l.id] = { on: !!l.primary || locs.length === 1, lineSets: "" };
      });
      if (locs.length && !locs.some((l) => venueSel[l.id]?.on)) {
        venueSel[locs[0].id] = { on: true, lineSets: "" };
      }
      const primary = cust.contacts.find((c) => c.primary) || cust.contacts[0] || null;
      initial = {
        ...initial,
        customerId: cust.id,
        quoteName: cust.name + " — Rigging inspection",
        venueSel,
        contactSel: primary ? primary.name : "",
        saved: false,
        approved: false,
      };
    }
  }

  /* Seed travel for the customer the builder OPENS on, so the venue list and
     its mileage are right on first paint with no round trip (punch #90). Every
     other customer resolves on selection. */
  if (initial.customerId) {
    const seeded = await travelForCustomerVenues(initial.customerId);
    const target = customers.find((c) => c.id === initial.customerId);
    if (target) {
      target.locations = target.locations.map((l) => ({
        ...l,
        oneWayMiles: seeded[l.id]?.miles ?? null,
        oneWayMin: seeded[l.id]?.minutes ?? null,
      }));
    }
  }

  return (
    <QuoteBuilder
      customers={customers}
      offices={offices}
      rates={rates}
      levels={LEVELS.map((l) => ({
        key: l.key,
        label: l.label,
        long: l.long,
        blurb: l.blurb,
      }))}
      initial={initial}
      me={user.name}
      accent={settings.accent || "#7b3f8a"}
    />
  );
}

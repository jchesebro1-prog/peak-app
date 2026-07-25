import { requireUser } from "@/lib/session";
import { all as allCustomers, type CustomerDoc } from "@/lib/stores/customers";
import { travelForId } from "@/lib/stores/customers";
import { get as getQuote } from "@/lib/stores/quotes";
import { getRates } from "@/lib/flametest-engine";
import { getSettings } from "@/lib/settings";
import { coordsOf } from "@/lib/geo";
import { QuoteBuilder, type BuilderCustomer, type BuilderInitial } from "./controls";
import { builderTiers } from "@/lib/pricing-tiers";

export const metadata = { title: "Flame test quote — Quartzite-6" };

/**
 * Flame test QUOTE builder — the auto-priced flame-test quote estimator
 * (pixel port of Flame Test Quote.dc.html). Interactive live calculator, so
 * the server component loads the customer directory + live rates + offices and
 * hands them to the QuoteBuilder client, which computes pricing live (the pure
 * flametest-engine math is inlined client-side; Save/Approve recompute
 * server-side in actions.ts — the store stays the source of truth).
 *
 * Deep-linked as /flame-tests/quote?id=<quoteId> to edit, or
 * ?customer=<customerId> to start a new quote for a customer.
 */

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/* flame-test quote subdoc shape (what actions.ts saves) */
type FtVenue = { id?: string | null; label?: string; curtains?: number };
type FtContact = { name?: string; role?: string; email?: string } | null;
type FlameTestDoc = { venues?: FtVenue[]; contact?: FtContact } | null;

export default async function FlameTestQuotePage({
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
  const saved = one(sp.saved) === "1";
  const approved = one(sp.approved) === "1";

  /* ---- serializable customer directory with per-venue coords + travel ---- */
  // Customer tier margins seed the builder's margin knob (item 11, D88).
  const tierInfo = await builderTiers(customerDocs.map((c: CustomerDoc) => c.id));
  const customers: BuilderCustomer[] = await Promise.all(
    customerDocs.map(async (c: CustomerDoc) => ({
      id: c.id,
      name: c.name,
      locations: await Promise.all(
        (c.locations || []).map(async (l) => {
          const coords = coordsOf(l);
          const t = l.id ? await travelForId(c.id, l.id) : await travelForId(c.id);
          return {
            id: l.id || "",
            label: l.label || "Venue",
            city: l.city || "",
            state: l.state || "",
            primary: !!l.primary,
            coords: coords ? { lat: coords.lat, lng: coords.lng } : null,
            oneWayMiles: t?.miles ?? null,
            oneWayMin: t?.minutes ?? null,
          };
        })
      ),
      contacts: (c.contacts || []).map((ct) => ({
        name: ct.name,
        role: ct.role || "",
        email: ct.email || "",
        primary: !!ct.primary,
        tierMargin: tierInfo[c.id]?.byContact[ct.name] ?? null,
      })),
      tierMargin: tierInfo[c.id]?.margin ?? null,
    }))
  );

  const offices = (Array.isArray(settings.offices) ? settings.offices : []).map((o) => ({
    name: o.name || "",
    lat: o.lat,
    lng: o.lng,
  }));

  /* ---- initial builder state (edit an existing quote, or preselect a customer) ---- */
  let initial: BuilderInitial = {
    editingId: null,
    customerId: "",
    quoteName: "",
    venueSel: {},
    contactSel: "",
    contactManual: "",
    saved,
    approved,
    savedId: "",
  };

  const editQuote = editId ? await getQuote(editId) : null;
  if (editQuote && editQuote.quoteType === "flame_test") {
    const ft: FlameTestDoc = (editQuote.flameTest as FlameTestDoc) || {};
    const cid = editQuote.customerId || "";
    const cust = customers.find((c) => c.id === cid) || null;
    const venueSel: BuilderInitial["venueSel"] = {};
    ((ft && ft.venues) || []).forEach((v) => {
      if (v.id) venueSel[v.id] = { on: true, curtains: String(v.curtains || "") };
    });
    const qc = editQuote.contact || (ft && ft.contact) || null;
    let contactSel = "";
    let contactManual = "";
    if (qc && (qc as { name?: string }).name) {
      const nm = (qc as { name: string }).name;
      const known = (cust?.contacts || []).some((c) => c.name === nm);
      if (known) contactSel = nm;
      else {
        contactSel = "__other__";
        contactManual = nm;
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
      saved,
      approved: approved || wonAlready,
      // an existing quote always has a letter target
      savedId: editQuote.id,
    };
  } else if (preCustomer) {
    const cust = customers.find((c) => c.id === preCustomer) || null;
    if (cust) {
      const locs = cust.locations;
      const venueSel: BuilderInitial["venueSel"] = {};
      locs.forEach((l) => {
        venueSel[l.id] = { on: !!l.primary || locs.length === 1, curtains: "" };
      });
      if (locs.length && !locs.some((l) => venueSel[l.id]?.on)) {
        venueSel[locs[0].id] = { ...venueSel[locs[0].id], on: true };
      }
      const primary = cust.contacts.find((c) => c.primary) || cust.contacts[0] || null;
      initial = {
        editingId: null,
        customerId: cust.id,
        quoteName: cust.name + " — Flame test",
        venueSel,
        contactSel: primary ? primary.name : "",
        contactManual: "",
        saved: false,
        approved: false,
        savedId: "",
      };
    }
  }

  return (
    <QuoteBuilder
      customers={customers}
      offices={offices}
      rates={rates}
      initial={initial}
      me={user.name}
      accent={settings.accent || "#7b3f8a"}
    />
  );
}

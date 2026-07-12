import { requireUser } from "@/lib/session";
import { all as allCustomers, type CustomerDoc } from "@/lib/stores/customers";
import { travelForId } from "@/lib/stores/customers";
import { get as getQuote } from "@/lib/stores/quotes";
import { get as getInspection } from "@/lib/stores/inspections";
import {
  CATEGORIES,
  PRIORITIES,
  priorityFromSeverity,
} from "@/lib/stores/repair-jobs";
import { getRates } from "@/lib/repair-engine";
import { getSettings } from "@/lib/settings";
import { coordsOf } from "@/lib/geo";
import { QuoteBuilder, type BuilderCustomer, type BuilderInitial } from "./controls";

export const metadata = { title: "Repair quote — Peak Backend" };

/**
 * Repair QUOTE builder — the auto-priced repair estimator (repair twin of the
 * flame-test quote screen). Interactive live calculator, so the server
 * component loads the customer directory + live rates + offices and hands
 * them to the QuoteBuilder client, which computes pricing live (the pure
 * repair-engine math is inlined client-side; Save/Approve recompute
 * server-side in actions.ts — the store stays the source of truth).
 *
 * Deep-linked as /repairs/quote?id=<quoteId> to edit,
 * ?customer=<customerId> to start a new quote for a customer, or
 * ?inspection=<inspId>&log=<logId> to quote a flagged inspection finding.
 */

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/* repair quote subdoc shape (what actions.ts saves) */
type RpVenue = { id?: string | null; label?: string };
type RpItem = { label?: string; qty?: number; note?: string };
type RpPart = { name?: string; qty?: number; cost?: number };
type RpContact = { name?: string; role?: string; email?: string } | null;
type RpSource = { kind: string; refId?: string; logId?: number; label: string };
type RepairDoc = {
  category?: string;
  priority?: string;
  scope?: string;
  source?: RpSource | null;
  items?: RpItem[];
  parts?: RpPart[];
  laborHours?: number;
  hoursEach?: number;
  crewSize?: number;
  contact?: RpContact;
  venues?: RpVenue[];
} | null;

export default async function RepairQuotePage({
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
  const inspId = one(sp.inspection);
  const logId = one(sp.log);
  const saved = one(sp.saved) === "1";
  const approved = one(sp.approved) === "1";

  /* ---- serializable customer directory with per-venue coords + travel ---- */
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
      })),
    }))
  );

  const offices = (Array.isArray(settings.offices) ? settings.offices : []).map((o) => ({
    name: o.name || "",
    lat: o.lat,
    lng: o.lng,
  }));

  /* ---- initial builder state (edit / inspection finding / preselected customer) ---- */
  let initial: BuilderInitial = {
    editingId: null,
    customerId: "",
    quoteName: "",
    venueSel: {},
    contactSel: "",
    contactManual: "",
    category: "rigging",
    priority: "standard",
    scopeItems: [],
    notes: "",
    parts: [],
    laborHours: "",
    crewSize: "1",
    source: null,
    saved,
    approved,
    savedId: "",
  };

  const editQuote = editId ? await getQuote(editId) : null;
  if (editQuote && editQuote.quoteType === "repair") {
    const rp: RepairDoc = (editQuote.repair as RepairDoc) || {};
    const cid = editQuote.customerId || "";
    const cust = customers.find((c) => c.id === cid) || null;
    const venueSel: BuilderInitial["venueSel"] = {};
    ((rp && rp.venues) || []).forEach((v) => {
      if (v.id) venueSel[v.id] = { on: true };
    });
    const qc = editQuote.contact || (rp && rp.contact) || null;
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
      category: (rp && rp.category) || "rigging",
      priority: (rp && rp.priority) || "standard",
      scopeItems: ((rp && rp.items) || []).map((i) => i.label || ""),
      notes: (rp && rp.scope) || "",
      parts: ((rp && rp.parts) || []).map((p) => ({
        name: p.name || "",
        qty: p.qty != null ? String(p.qty) : "",
        cost: p.cost != null ? String(p.cost) : "",
      })),
      laborHours:
        rp && rp.hoursEach != null
          ? String(rp.hoursEach)
          : rp && rp.laborHours != null
            ? String(rp.laborHours)
            : "",
      crewSize: String((rp && rp.crewSize) || 1),
      source: (rp && rp.source) || null,
      saved,
      approved: approved || wonAlready,
      savedId: editQuote.id,
    };
  } else if (inspId) {
    const insp = await getInspection(inspId);
    const log = insp ? (insp.logs || []).find((l) => String(l.id) === logId) || null : null;
    const cid = insp?.customerId || preCustomer;
    const cust = cid ? customers.find((c) => c.id === cid) || null : null;
    if (insp && cust) {
      const locs = cust.locations;
      const venueSel: BuilderInitial["venueSel"] = {};
      if (insp.locationId && locs.some((l) => l.id === insp.locationId)) {
        venueSel[insp.locationId] = { on: true };
      } else {
        locs.forEach((l) => {
          venueSel[l.id] = { on: !!l.primary || locs.length === 1 };
        });
        if (locs.length && !locs.some((l) => venueSel[l.id]?.on)) {
          venueSel[locs[0].id] = { on: true };
        }
      }
      // prefer the inspection's contact when it matches the directory
      let contactSel = "";
      let contactManual = "";
      const nm = (insp.contact || "").trim();
      if (nm) {
        if (cust.contacts.some((c) => c.name === nm)) contactSel = nm;
        else {
          contactSel = "__other__";
          contactManual = nm;
        }
      } else {
        const primary = cust.contacts.find((c) => c.primary) || cust.contacts[0] || null;
        contactSel = primary ? primary.name : "";
      }
      initial = {
        editingId: null,
        customerId: cust.id,
        quoteName: cust.name + " — " + (log?.problem || "Repair"),
        venueSel,
        contactSel,
        contactManual,
        category: "rigging",
        priority: priorityFromSeverity(log?.severity),
        scopeItems: [log?.problem || "Repair"],
        notes: [
          log?.explanation || "",
          log?.solution ? "Recommended: " + log.solution : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        parts: [],
        laborHours: log?.estHours != null ? String(log.estHours) : "",
        crewSize: "1",
        source: {
          kind: "inspection",
          refId: insp.id,
          ...(log ? { logId: log.id } : {}),
          label: "From inspection " + insp.id,
        },
        saved: false,
        approved: false,
        savedId: "",
      };
    }
  } else if (preCustomer) {
    const cust = customers.find((c) => c.id === preCustomer) || null;
    if (cust) {
      const locs = cust.locations;
      const venueSel: BuilderInitial["venueSel"] = {};
      locs.forEach((l) => {
        venueSel[l.id] = { on: !!l.primary || locs.length === 1 };
      });
      if (locs.length && !locs.some((l) => venueSel[l.id]?.on)) {
        venueSel[locs[0].id] = { on: true };
      }
      const primary = cust.contacts.find((c) => c.primary) || cust.contacts[0] || null;
      initial = {
        ...initial,
        customerId: cust.id,
        quoteName: cust.name + " — Repair",
        venueSel,
        contactSel: primary ? primary.name : "",
        saved: false,
        approved: false,
      };
    }
  }

  return (
    <QuoteBuilder
      customers={customers}
      offices={offices}
      rates={rates}
      categories={CATEGORIES.map((c) => ({ key: c.key, label: c.label }))}
      priorities={PRIORITIES.map((p) => ({ key: p.key, label: p.label }))}
      initial={initial}
      me={user.name}
      accent={settings.accent || "#7b3f8a"}
    />
  );
}

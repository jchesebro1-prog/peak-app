"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { portalSession, PORTAL_COOKIE } from "@/lib/portal";
import { get as getCustomer } from "@/lib/stores/customers";
import { create as createLead } from "@/lib/stores/leads";
import {
  create as createQuote,
  get as getQuote,
  update as updateQuote,
} from "@/lib/stores/quotes";
import { byCategory, get as getCatalogPart } from "@/lib/stores/catalog";
import { isCustomerBuyable } from "@/lib/portal-catalog";
import { curtainCost } from "@/lib/curtain-pricing";
import { SEED_FABRIC_RATES } from "@/lib/design/curtain-pricing";
import { resolveTier } from "@/lib/pricing-tiers";
import { curtainQty, type CurtainSpec } from "@/lib/curtain-geom";

/**
 * Portal mutations (IDEAS #47). SECURITY: these run for ANONYMOUS visitors —
 * every action authenticates via portalSession() (the grant cookie) and
 * derives its customerId from the session only. Nothing here touches
 * requireUser()/team endpoints, and no client-posted customer id is trusted.
 */

/* Customer-facing service types → the lead's `interest` field. Mirrored in
 * request-form.tsx ("use server" modules may only export async functions,
 * so the list is duplicated rather than exported). */
const SERVICES = [
  "Flame testing",
  "Rigging inspection",
  "Repair",
  "New system / renovation",
  "Something else",
];
const URGENCIES = ["Standard", "Urgent", "Emergency — out of service"];

export async function submitPortalRequest(formData: FormData): Promise<void> {
  const session = await portalSession();
  if (!session) redirect("/portal?denied=1");

  const cust = await getCustomer(session.customerId);
  if (!cust) redirect("/portal?denied=1");

  const serviceRaw = String(formData.get("service") || "");
  const service = SERVICES.includes(serviceRaw) ? serviceRaw : "Something else";
  const urgencyRaw = String(formData.get("urgency") || "");
  const urgency = URGENCIES.includes(urgencyRaw) ? urgencyRaw : "Standard";
  const venueId = String(formData.get("venue") || "");
  const venue = (cust.locations || []).find((l) => l.id === venueId) || null;
  const phone = String(formData.get("phone") || "").trim().slice(0, 40);
  const details = String(formData.get("details") || "").trim().slice(0, 4000);
  if (!details) redirect("/portal/request?err=details");

  const venueLabel = venue ? venue.label || "Venue" : "Venue TBD";
  const message =
    "[Portal request — " +
    session.name +
    "] " +
    venueLabel +
    " · " +
    service +
    " · " +
    urgency +
    "\n\n" +
    details;

  await createLead(
    {
      org: cust.name,
      contact: session.name,
      email: session.email,
      phone,
      city: venue?.city || "",
      state: venue?.state || "WI",
      source: "existing",
      owner: "", // unassigned → enters the SLA response queue
      interest: service,
      message,
      customerId: session.customerId,
    },
    session.name
  );

  revalidatePath("/", "layout");
  redirect("/portal?sent=1");
}

/**
 * Non-binding quote acceptance (IDEAS #47 P3, Jeff's design call): the
 * button only FLAGS a follow-up for the team — a human confirms by marking
 * the quote Won, which runs the normal accepted-quote spawn machinery.
 * Tenant check: the quote must belong to the grant's customer and be in the
 * published "sent" state.
 */
export async function acceptPortalQuote(formData: FormData): Promise<void> {
  const session = await portalSession();
  if (!session) redirect("/portal?denied=1");

  const id = String(formData.get("quote") || "");
  const q = id ? await getQuote(id) : null;
  if (
    q &&
    q.customerId === session.customerId &&
    q.status === "sent" &&
    !q.portalAcceptance
  ) {
    await updateQuote(id, {
      portalAcceptance: { at: Date.now(), by: session.name, byEmail: session.email },
    });
  }
  revalidatePath("/", "layout");
  redirect("/portal?accepted=1");
}

/**
 * Self-serve drapery estimate (IDEAS #48). SECURITY + PRICING: runs for an
 * anonymous portal visitor — authenticates via portalSession(), scopes to the
 * grant's customerId, and RECOMPUTES every line server-side from the real
 * fabric cost basis (curtainCost). The client-posted prices are never trusted;
 * the persisted draft matches what the team estimator would produce. Lands as a
 * DRAFT quote (source "portal-self-serve", unassigned) — never published, never
 * binding. An estimator finalizes and publishes it through the normal flow.
 */
export async function submitPortalEstimate(formData: FormData): Promise<void> {
  const session = await portalSession();
  if (!session) redirect("/portal?denied=1");

  const cust = await getCustomer(session.customerId);
  if (!cust) redirect("/portal?denied=1");

  // Tier pricing (item 11 D, D88) — must resolve exactly as the preview page
  // did so the customer's live numbers equal the quote they receive.
  const tier = await resolveTier(session.customerId, session.name);

  const project = String(formData.get("project") || "").trim().slice(0, 120);
  const venueId = String(formData.get("venue") || "");
  const venue = (cust.locations || []).find((l) => l.id === venueId) || null;

  // Parse the posted line specs (raw strings; prices are recomputed here).
  let raw: unknown = [];
  try {
    raw = JSON.parse(String(formData.get("lines") || "[]"));
  } catch {
    raw = [];
  }
  const specs: CurtainSpec[] = (Array.isArray(raw) ? raw : [])
    .slice(0, 40)
    .map((r) => {
      const o = (r || {}) as Record<string, unknown>;
      const s = (k: string) => String(o[k] ?? "");
      return {
        name: s("name").slice(0, 120),
        hang: s("hang"),
        fabric: s("fabric"),
        qty: s("qty"),
        width: s("width"),
        height: s("height"),
        fullness: s("fullness"),
        bottom: s("bottom"),
      };
    });

  // Fabric cost basis — server-side only. Map sku → { costPerSqft, desc }.
  const fabricRows = await byCategory("Fabric");
  const fabricById = new Map(fabricRows.map((p) => [p.sku, p]));

  type Item = {
    id: number;
    sku: string;
    desc: string;
    qty: number;
    unit: string;
    cost: number;
    price: number;
    curtain?: true;
    comment?: string;
  };
  const items: Item[] = [];
  let rev = 0;
  let cost = 0;
  let nextId = 1;

  for (const spec of specs) {
    const fab = fabricById.get(spec.fabric);
    if (!fab) continue; // unknown fabric — drop the line
    const rate = fab.curtainAreaRate ?? SEED_FABRIC_RATES[fab.sku] ?? fab.costPerSqft ?? 0;
    const { costEach, priceEach } = curtainCost(spec, rate, tier.margin);
    if (priceEach <= 0) continue; // no dimensions — skip
    const qty = curtainQty(spec);
    const h = parseFloat(spec.height) || 0;
    const w = parseFloat(spec.width) || 0;
    const fullLabel = spec.fullness === "0" ? "Flat" : (parseFloat(spec.fullness) || 0) + "% fullness";
    items.push({
      id: nextId++,
      sku: fab.sku,
      desc: (spec.name.trim() || "Curtain") + " — " + fab.desc,
      qty,
      unit: "ea",
      cost: costEach,
      price: priceEach,
      curtain: true,
      comment:
        w + "′w × " + h + "′h · " + fullLabel + " · " + spec.hang + " hang · " + spec.bottom + " bottom",
    });
    rev += qty * priceEach;
    cost += qty * costEach;
  }

  const sections: Array<{ id: string; name: string; kind: string; mfr: string; freightPct: number; items: Item[] }> = [];
  if (items.length > 0) {
    sections.push({ id: "SEC-DRAPE", name: "Drapery & soft goods", kind: "materials", mfr: "", freightPct: 0, items });
  }

  // Equipment lines: the client posts { sku, qty }. Look each part up here and
  // RE-PRICE from the catalog (list = price, cost = cost) — client prices are
  // never trusted — and reject anything outside the customer-buyable set, so a
  // guessed internal SKU can't be added.
  let equipRaw: unknown = [];
  try {
    equipRaw = JSON.parse(String(formData.get("equipment") || "[]"));
  } catch {
    equipRaw = [];
  }
  const equipItems: Item[] = [];
  for (const r of (Array.isArray(equipRaw) ? equipRaw : []).slice(0, 100)) {
    const o = (r || {}) as Record<string, unknown>;
    const sku = String(o.sku ?? "").trim();
    const qty = Math.max(1, Math.min(9999, parseInt(String(o.qty ?? ""), 10) || 0));
    if (!sku || qty < 1) continue;
    const part = await getCatalogPart(sku);
    if (!isCustomerBuyable(part)) continue; // unknown / internal / flagged part
    // Tier pricing (item 11 D, D88): customer price re-derived from cost at
    // the tier margin; parts without a cost keep list — mirrors customerCatalog.
    const sell =
      typeof part.cost === "number" && part.cost > 0 && tier.margin > 0 && tier.margin < 1
        ? Math.round((part.cost / (1 - tier.margin)) * 100) / 100
        : part.list;
    equipItems.push({
      id: nextId++,
      sku: part.sku,
      desc: part.desc,
      qty,
      unit: part.unit || "ea",
      cost: part.cost || 0,
      price: sell,
      ...(part.mfr ? { comment: part.mfr } : {}),
    });
    rev += qty * sell;
    cost += qty * (part.cost || 0);
  }
  if (equipItems.length > 0) {
    sections.push({ id: "SEC-EQUIP", name: "Equipment & supplies", kind: "materials", mfr: "", freightPct: 0, items: equipItems });
  }

  if (sections.length === 0) redirect("/portal/estimate?err=empty");

  const margin = rev > 0 ? (rev - cost) / rev : 0;
  const hasDrape = items.length > 0;
  const hasEquip = equipItems.length > 0;
  const defaultName = hasDrape && hasEquip ? "Equipment & drapery estimate" : hasEquip ? "Equipment estimate" : "Drapery estimate";

  const created = await createQuote({
    name: cust.name + " — " + (project || defaultName),
    customer: cust.name,
    customerId: session.customerId,
    locationId: venue?.id || null,
    value: Math.round(rev),
    margin,
    pricingTier: tier.tier,
    tierMargin: tier.margin,
    source: "portal-self-serve",
    spec: { sections, mobs: [] },
  });
  // Stamp portal provenance + leave it unassigned for the response queue.
  const patch = {
    owner: "",
    contactName: session.name,
    quoteNote:
      "Submitted by " +
      session.name +
      " via the customer portal self-serve estimator. Prices are budgetary — review and confirm before sending.",
  };
  await updateQuote(created.id, patch as unknown as Parameters<typeof updateQuote>[1]);

  revalidatePath("/", "layout");
  redirect("/portal?estimate=1");
}

export async function portalSignOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(PORTAL_COOKIE);
  redirect("/portal");
}

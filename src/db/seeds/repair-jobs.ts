import type {
  RepairJobRecord,
  RepairPart,
  RepairScopeItem,
} from "@/lib/stores/repair-jobs";

/**
 * Repair-job seed — verbatim port of seedData() from app/repairjobs.js.
 *
 * A spread across the lifecycle, priority and warranty states so every view
 * (dashboard, scheduler, both maps, warranty follow-ups) is populated. Tied
 * to the same real customer venues used across flame tests / inspections,
 * with coords embedded so the maps work with no network.
 *
 * Timestamps are relative to Date.now() at call time, exactly like the
 * prototype (ago/ahead day offsets).
 */

const DAY = 86400000;

function now(): number {
  return Date.now();
}
function ago(d: number): number {
  return now() - d * DAY;
}
function ahead(d: number): number {
  return now() + d * DAY;
}
function pad(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}
function iso(ts: number | null | undefined): string {
  if (ts == null) return "";
  const d = new Date(ts);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function part(name: string, qty: number, cost: number): RepairPart {
  return { name, qty, cost };
}
function item(label: string, qty?: number, note?: string): RepairScopeItem {
  return { label, qty: qty || 1, note: note || "" };
}

export function repairJobsSeed(): RepairJobRecord[] {
  const list: Array<Omit<RepairJobRecord, "createdAt" | "updatedAt">> = [
    // ---- COMPLETED · warranty LAPSED (14 months ago) — a follow-up candidate ----
    {
      id: "RP-4001", quoteId: "RPQ-2001", customer: "Lakefront Performing Arts Center", customerId: "lakefront", locationId: "lf1",
      venue: "Main Hall", value: 4850, category: "rigging", priority: "urgent",
      title: "Replace 6 worn rope locks on the operating rail",
      scope: "Remove and replace six worn rope locks showing flattened cams; test each line set for smooth, holding operation.",
      source: { kind: "inspection", refId: "RI-2042", logId: 6, label: "From inspection RI-2042" },
      items: [item("Rope lock replacement", 6, "Sets 4, 6, 9, 12, 18, 24"), item("Line-set operation test", 6, "")],
      parts: [part("Rope lock — J.R. Clancy", 6, 118)],
      laborHours: 10,
      contact: { name: "Dana Whitlock", role: "Facilities Director", email: "dwhitlock@lakefrontpac.org", phone: "(414) 555-0148" },
      venues: [{ id: "lf1", label: "Main Hall", city: "Milwaukee", state: "WI", lat: 43.043, lng: -87.910 }],
      stage: "completed", assignedTo: "Nic Trapani", crew: ["Nic Trapani", "Jason Keagy"],
      approvedAt: ago(445), scheduledDate: iso(ago(432)), completedAt: ago(430), warrantyMonths: 12,
      completion: { performedBy: "Nic Trapani", workPerformed: "All six rope locks replaced with new J.R. Clancy units; every affected line set cycled and confirmed holding. Old locks left with venue staff.", partsUsed: ["6 × rope lock"], followUp: "Recommend full operating-rail refresh next renovation cycle.", photos: [] },
      owner: "Nic Trapani",
    },
    // ---- COMPLETED · warranty ENDING (within 45-day window, ~11 months ago) ----
    {
      id: "RP-4002", quoteId: "RPQ-2002", customer: "North Ridge High School", customerId: "northridge", locationId: "nr1",
      venue: "Main Auditorium", value: 2650, category: "motors", priority: "standard",
      title: "Service and re-commission grand drape curtain machine",
      scope: "Curtain machine stalling mid-travel. Replace worn drive belt, re-tension, lubricate track carriers, and re-commission limits.",
      source: { kind: "direct", label: "Called in by venue" },
      items: [item("Curtain-machine service", 1, ""), item("Limit re-commission", 1, "")],
      parts: [part("Drive belt", 1, 84), part("Track carriers", 12, 9)],
      laborHours: 6,
      contact: { name: "Greg Salas", role: "Auditorium Manager", email: "gsalas@northridgehs.edu", phone: "(920) 555-0176" },
      venues: [{ id: "nr1", label: "Main Auditorium", city: "Appleton", state: "WI", lat: 44.300, lng: -88.391 }],
      stage: "completed", assignedTo: "Jason Keagy", crew: ["Jason Keagy"],
      approvedAt: ago(342), scheduledDate: iso(ago(326)), completedAt: ago(324), warrantyMonths: 12,
      completion: { performedBy: "Jason Keagy", workPerformed: "Replaced drive belt and 12 track carriers, re-tensioned, lubricated, and re-set open/close limits. Curtain now travels smoothly full stroke.", partsUsed: ["1 × drive belt", "12 × track carrier"], followUp: "", photos: [] },
      owner: "Jason Keagy",
    },
    // ---- COMPLETED · under warranty (2 months ago) ----
    {
      id: "RP-4003", quoteId: "RPQ-2003", customer: "Northshore Theater", customerId: "northshore", locationId: "ns1",
      venue: "Main House", value: 1980, category: "fallprotection", priority: "urgent",
      title: "Install self-closing gate at loading-gallery ladder",
      scope: "Fabricate and install an OSHA-compliant self-closing safety gate at the SL loading-gallery ladder access.",
      source: { kind: "inspection", refId: "RI-2042", logId: 1, label: "From inspection RI-2042" },
      items: [item("Self-closing gate — fabricate & install", 1, "SL loading gallery")],
      parts: [part("Self-closing safety gate", 1, 340), part("Mounting hardware kit", 1, 45)],
      laborHours: 8,
      contact: { name: "Susan Marsh", role: "Operations Director", email: "smarsh@northshoretheater.org", phone: "(920) 555-0155" },
      venues: [{ id: "ns1", label: "Main House", city: "Sheboygan", state: "WI", lat: 43.748, lng: -87.711 }],
      stage: "completed", assignedTo: "Nic Trapani", crew: ["Nic Trapani"],
      approvedAt: ago(74), scheduledDate: iso(ago(62)), completedAt: ago(60), warrantyMonths: 12,
      completion: { performedBy: "Nic Trapani", workPerformed: "Self-closing gate fabricated to opening and installed at the loading-gallery ladder; swing and latch verified. Fall hazard closed.", partsUsed: ["1 × safety gate"], followUp: "", photos: [] },
      owner: "Nic Trapani",
    },
    // ---- SCHEDULED · upcoming (emergency) ----
    {
      id: "RP-4004", quoteId: "RPQ-2004", customer: "Bayfront Arena", customerId: "bayfront", locationId: "ba1",
      venue: "Arena Floor", value: 6400, category: "motors", priority: "emergency",
      title: "Downed chain hoist on center truss — out of service",
      scope: "Center-truss chain hoist tripped and will not run; truss stuck mid-air. Emergency response to safe the load, diagnose, and repair or swap the hoist.",
      source: { kind: "direct", label: "Emergency call" },
      items: [item("Emergency response & make-safe", 1, ""), item("Hoist diagnose / repair", 1, "")],
      parts: [part("Contactor", 1, 96), part("Chain-hoist brake kit", 1, 210)],
      laborHours: 12,
      contact: { name: "Derek Cole", role: "Venue Operations", email: "dcole@bayfrontarena.com", phone: "(920) 555-0161" },
      venues: [{ id: "ba1", label: "Arena Floor", city: "Green Bay", state: "WI", lat: 44.502, lng: -88.061 }],
      stage: "scheduled", assignedTo: "Jason Keagy", crew: ["Jason Keagy", "Nic Trapani"],
      approvedAt: ago(1), scheduledDate: iso(ahead(1)), completedAt: null, warrantyMonths: 12,
      completion: null, owner: "Jason Keagy",
    },
    // ---- SCHEDULED · this week ----
    {
      id: "RP-4005", quoteId: "RPQ-2005", customer: "Lakeside Community Church", customerId: "lakeside", locationId: "lc1",
      venue: "Sanctuary", value: 1450, category: "curtains", priority: "standard",
      title: "Re-hem and re-hang sanctuary main traveler",
      scope: "Main traveler dragging on the deck. Take down, re-hem to correct trim, replace snap tape, and re-hang.",
      source: { kind: "survey", refId: "SV-1188", label: "From field survey" },
      items: [item("Traveler re-hem", 1, ""), item("Snap-tape replacement", 1, ""), item("Re-hang & trim", 1, "")],
      parts: [part("Snap tape (roll)", 2, 28)],
      laborHours: 7,
      contact: { name: "Pastor Liam Boyd", role: "Operations", email: "liam@lakesidechurch.org", phone: "(920) 555-0133" },
      venues: [{ id: "lc1", label: "Sanctuary", city: "Oshkosh", state: "WI", lat: 44.052, lng: -88.543 }],
      stage: "scheduled", assignedTo: "Nic Trapani", crew: ["Nic Trapani"],
      approvedAt: ago(6), scheduledDate: iso(ahead(4)), completedAt: null, warrantyMonths: 12,
      completion: null, owner: "Nic Trapani",
    },
    // ---- APPROVED · awaiting scheduling (from inspection) ----
    {
      id: "RP-4006", quoteId: "RPQ-2006", customer: "Lakefront Performing Arts Center", customerId: "lakefront", locationId: "lf1",
      venue: "Main Hall", value: 3200, category: "firecurtain", priority: "urgent",
      title: "Add deceleration device to fire curtain",
      scope: "Fire curtain has no deceleration device (ANSI E1.22). Install a dashpot so the curtain takes at least 5 s over the last 8 ft of travel.",
      source: { kind: "inspection", refId: "RI-2042", logId: 7, label: "From inspection RI-2042" },
      items: [item("Dashpot supply & install", 1, ""), item("Drop test & certify", 1, "")],
      parts: [part("Fire-curtain dashpot", 1, 1150)],
      laborHours: 9,
      contact: { name: "Tom Reyes", role: "Technical Director", email: "treyes@lakefrontpac.org", phone: "(414) 555-0150" },
      venues: [{ id: "lf1", label: "Main Hall", city: "Milwaukee", state: "WI", lat: 43.043, lng: -87.910 }],
      stage: "approved", assignedTo: "", crew: [],
      approvedAt: ago(3), scheduledDate: "", completedAt: null, warrantyMonths: 12,
      completion: null, owner: "Jeff Chesebro",
    },
    // ---- APPROVED · awaiting scheduling (low) ----
    {
      id: "RP-4007", quoteId: "RPQ-2007", customer: "Badger Ballet Company", customerId: "badger", locationId: "bb1",
      venue: "Main Stage", value: 780, category: "rigging", priority: "low",
      title: "Remove unused sheaves & add capacity signage",
      scope: "Clear redundant sheaves/hardware from the head-block steel and post rated-capacity signage at the operating rail and loading gallery.",
      source: { kind: "inspection", refId: "RI-2042", logId: 14, label: "From inspection RI-2042" },
      items: [item("Remove unused overhead hardware", 1, ""), item("Capacity signage", 2, "Rail + loading gallery")],
      parts: [part("Capacity sign (printed)", 2, 32)],
      laborHours: 4,
      contact: { name: "Priya Anand", role: "Production Manager", email: "priya@badgerballet.org", phone: "(608) 555-0119" },
      venues: [{ id: "bb1", label: "Main Stage", city: "Madison", state: "WI", lat: 43.075, lng: -89.391 }],
      stage: "approved", assignedTo: "", crew: [],
      approvedAt: ago(2), scheduledDate: "", completedAt: null, warrantyMonths: 12,
      completion: null, owner: "Jeff Chesebro",
    },
  ];
  const t = now();
  return list.map((j) => ({
    createdAt: j.approvedAt || t,
    updatedAt: t,
    syncState: "synced" as const,
    syncedAt: t,
    rev: 3,
    ...j,
  }));
}

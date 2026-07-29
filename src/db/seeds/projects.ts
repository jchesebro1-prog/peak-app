import type { ProcurementLine, ProjectRecord } from "@/lib/stores/projects";

/**
 * Projects & sales orders seed — exact port of app/project.js seedData():
 * realistic in-flight work across every stage. Timestamps are relative to
 * "now" at call time, exactly like the prototype's ago()/ahead().
 *
 * The prototype's migrate() backfilled `mobilizations: []` on records that
 * predate the field; the seed docs carry the post-migrate shape directly.
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
function uid(p?: string): string {
  return (p || "x") + Math.random().toString(36).slice(2, 8);
}

/** Vendor lead-time knowledge (project.js VENDORS — lead days only). */
const VENDOR_LEAD: Record<string, number> = {
  "JR Clancy": 45,
  "Rose Brand": 32,
  ETC: 56,
  Wenger: 70,
  "In-stock": 10,
};

/** Build a procurement line — inline port of project.js line(). */
function line(o: Partial<ProcurementLine>): ProcurementLine {
  const vend = o.vendor || "In-stock";
  return {
    id: o.id || uid("pl-"),
    sku: o.sku || "",
    desc: o.desc || "Item",
    vendor: vend,
    qty: o.qty || 1,
    unit: o.unit || "ea",
    cost: o.cost || 0,
    leadDays: o.leadDays != null ? o.leadDays : VENDOR_LEAD[vend] != null ? VENDOR_LEAD[vend] : 21,
    status: o.status || "pending",
    orderedAt: o.orderedAt || null,
    po: o.po || "",
  };
}

export function projectsSeed(): ProjectRecord[] {
  const pm = "Jeff Chesebro"; // prototype: (window.Team && window.Team.CURRENT) || 'Jeff Chesebro'
  return [
    // ---- INSTALL in progress (the active job) ----
    {
      id: "P-3001",
      kind: "project",
      quoteId: "Q-2035",
      name: "Lakeside Community Church — Drapery & Track",
      customer: "Lakeside Community Church",
      customerId: "lakeside",
      locationId: "lc1",
      owner: pm,
      value: 41720,
      margin: 0.36,
      createdAt: ago(20),
      updatedAt: ago(0),
      startedAt: ago(18),
      targetDate: ahead(3),
      installStart: ago(1),
      installEnd: ahead(2),
      stage: "install",
      stageHistory: [],
      procurement: [
        line({ sku: "RB-MV-MN", desc: "25oz Memorable Velour — main drape", vendor: "Rose Brand", qty: 1, unit: "lot", cost: 9800, leadDays: 32, status: "received", orderedAt: ago(16), po: "PO-1042" }),
        line({ sku: "JC-T6-TRK", desc: "T6 walkalong track, 44ft", vendor: "JR Clancy", qty: 2, unit: "ea", cost: 3120, leadDays: 30, status: "received", orderedAt: ago(16), po: "PO-1043" }),
        line({ sku: "JC-HW-KIT", desc: "Hardware & batten clamps", vendor: "In-stock", qty: 1, unit: "lot", cost: 640, leadDays: 7, status: "received", orderedAt: ago(15), po: "PO-1044" }),
      ],
      mobilizations: [],
      deliveries: [
        { id: uid("dl-"), label: "Rose Brand soft goods", vendor: "Rose Brand", eta: ago(4), status: "received", receivedAt: ago(4) },
        { id: uid("dl-"), label: "Clancy track & hardware", vendor: "JR Clancy", eta: ago(3), status: "received", receivedAt: ago(3) },
      ],
      crew: [
        { id: uid("cw-"), person: "Nic Trapani", role: "Rigging lead", start: ago(1), end: ahead(2) },
        { id: uid("cw-"), person: "Jason Keagy", role: "Installer", start: ago(1), end: ahead(2) },
      ],
      tasks: [
        { id: uid("tk-"), title: "Confirm site access & dock", section: "Mobilize", assignee: "Nic Trapani", done: true, doneAt: ago(1) },
        { id: uid("tk-"), title: "Hang & level walkalong track", section: "Install", assignee: "Nic Trapani", done: true, doneAt: ago(0) },
        { id: uid("tk-"), title: "Hang main drape & trim fullness", section: "Install", assignee: "Jason Keagy", done: false },
        { id: uid("tk-"), title: "Dress pleats & weight chain", section: "Install", assignee: "Jason Keagy", done: false },
        { id: uid("tk-"), title: "Operational test & punch walk", section: "Closeout", assignee: "Nic Trapani", done: false },
      ],
      notes: [
        { id: uid("nt-"), by: "Nic Trapani", at: ago(1), text: "Dock height fine, freight elevator out — hand-carrying to house. Add ~2hrs.", photo: null },
        { id: uid("nt-"), by: "Jason Keagy", at: ago(0), text: "Track set & leveled, glides run smooth end to end.", photo: null },
      ],
      timeLogs: [
        { id: uid("tl-"), person: "Nic Trapani", date: ago(1), hours: 9, note: "Mobilize + track" },
        { id: uid("tl-"), person: "Jason Keagy", date: ago(1), hours: 9, note: "Track + rig prep" },
        { id: uid("tl-"), person: "Nic Trapani", date: ago(0), hours: 6, note: "Drape hang" },
      ],
      signoff: null,
      trainingAt: null,
    },

    // ---- CREW SCHEDULED (materials in, install next week) ----
    {
      id: "P-3002",
      kind: "project",
      quoteId: null,
      name: "Northshore Theater — Counterweight Upgrade",
      customer: "Northshore Theater",
      customerId: "northshore",
      locationId: "ns1",
      owner: "Jack Hamilton",
      value: 58200,
      margin: 0.3,
      createdAt: ago(12),
      updatedAt: ago(1),
      startedAt: ago(11),
      targetDate: ahead(12),
      installStart: ahead(8),
      installEnd: ahead(12),
      stage: "scheduled",
      stageHistory: [],
      procurement: [
        line({ sku: "JC-PWC-SET", desc: "PowerLift counterweight sets (8)", vendor: "JR Clancy", qty: 8, unit: "set", cost: 14400, leadDays: 45, status: "received", orderedAt: ago(40), po: "PO-1031" }),
        line({ sku: "JC-LOFT-BLK", desc: "Loft blocks & head blocks", vendor: "JR Clancy", qty: 1, unit: "lot", cost: 6200, leadDays: 45, status: "received", orderedAt: ago(40), po: "PO-1031" }),
        line({ sku: "JC-ARBOR", desc: "Arbor & guide hardware", vendor: "In-stock", qty: 1, unit: "lot", cost: 1850, leadDays: 7, status: "received", orderedAt: ago(20), po: "PO-1035" }),
      ],
      mobilizations: [],
      deliveries: [
        { id: uid("dl-"), label: "Clancy counterweight package", vendor: "JR Clancy", eta: ago(2), status: "received", receivedAt: ago(2) },
      ],
      crew: [
        { id: uid("cw-"), person: "Nic Trapani", role: "Rigging lead", start: ahead(8), end: ahead(12) },
        { id: uid("cw-"), person: "Jason Keagy", role: "Installer", start: ahead(8), end: ahead(12) },
      ],
      tasks: [
        { id: uid("tk-"), title: "Confirm dark week & house clearance", section: "Mobilize", assignee: "Jack Hamilton", done: true, doneAt: ago(3) },
        { id: uid("tk-"), title: "Stage hardware to loading dock", section: "Mobilize", assignee: "Nic Trapani", done: false },
      ],
      notes: [],
      timeLogs: [],
      signoff: null,
      trainingAt: null,
    },

    // ---- PROCUREMENT (long-lead, at-risk critical item) ----
    {
      id: "P-3003",
      kind: "project",
      quoteId: null,
      name: "North Ridge HS — Auditorium Rigging Refit",
      customer: "North Ridge High School",
      customerId: "northridge",
      locationId: "nr1",
      owner: "Nic Trapani",
      value: 86400,
      margin: 0.34,
      createdAt: ago(6),
      updatedAt: ago(0),
      startedAt: ago(5),
      targetDate: ahead(40),
      installStart: ahead(36),
      installEnd: ahead(42),
      stage: "procurement",
      stageHistory: [],
      procurement: [
        line({ sku: "ETC-SENSOR3", desc: "Sensor3 dimming + ThruPower racks", vendor: "ETC", qty: 2, unit: "rack", cost: 18600, leadDays: 56, status: "ordered", orderedAt: ago(4), po: "PO-1051" }),
        line({ sku: "JC-PH-HOIST", desc: "PowerAssist line-shaft hoists (6)", vendor: "JR Clancy", qty: 6, unit: "ea", cost: 22800, leadDays: 60, status: "ordered", orderedAt: ago(2), po: "PO-1052" }),
        line({ sku: "RB-EN-16", desc: "16oz Encore Velour — full soft goods pkg", vendor: "Rose Brand", qty: 1, unit: "lot", cost: 12400, leadDays: 32, status: "pending", orderedAt: null, po: "" }),
        line({ sku: "JC-BATTEN", desc: "Battens & pipe, schedule 40", vendor: "In-stock", qty: 1, unit: "lot", cost: 3100, leadDays: 10, status: "pending", orderedAt: null, po: "" }),
      ],
      mobilizations: [
        { id: uid("mb-"), type: "Site Visit", days: 1, crew: 2, discipline: "Rigging" },
        { id: uid("mb-"), type: "Install", days: 6, crew: 4, discipline: "Rigging" },
        { id: uid("mb-"), type: "Commissioning", days: 2, crew: 2, discipline: "Rigging" },
        { id: uid("mb-"), type: "Training", days: 1, crew: 1, discipline: "Rigging" },
      ],
      deliveries: [],
      crew: [],
      tasks: [
        { id: uid("tk-"), title: "Release soft-goods PO (32-day lead)", section: "Procurement", assignee: "Nic Trapani", done: false },
        { id: uid("tk-"), title: "Field-verify grid heights before fab", section: "Procurement", assignee: "Nic Trapani", done: false },
      ],
      notes: [],
      timeLogs: [],
      signoff: null,
      trainingAt: null,
    },

    // ---- SALES ORDER (materials only, no labor) ----
    {
      id: "S-4001",
      kind: "order",
      quoteId: null,
      name: "Bayfront Arena — Replacement Drape Set",
      customer: "Bayfront Arena",
      customerId: "bayfront",
      locationId: "ba1",
      owner: "Jena Tolksdorf",
      value: 18600,
      margin: 0.33,
      createdAt: ago(8),
      updatedAt: ago(1),
      startedAt: ago(7),
      targetDate: ahead(9),
      installStart: null,
      installEnd: null,
      stage: "delivery",
      stageHistory: [],
      procurement: [
        line({ sku: "RB-COM-16", desc: "16oz Commando Cloth — black masking", vendor: "Rose Brand", qty: 1, unit: "lot", cost: 7400, leadDays: 32, status: "shipped", orderedAt: ago(6), po: "PO-1048" }),
        line({ sku: "RB-WEBTIE", desc: "Webbing, ties & grommets", vendor: "In-stock", qty: 1, unit: "lot", cost: 520, leadDays: 7, status: "received", orderedAt: ago(6), po: "PO-1049" }),
      ],
      mobilizations: [],
      deliveries: [
        { id: uid("dl-"), label: "Rose Brand drape set → ship to customer", vendor: "Rose Brand", eta: ahead(4), status: "in_transit" },
      ],
      crew: [],
      tasks: [],
      notes: [],
      timeLogs: [],
      signoff: null,
      trainingAt: null,
    },

    // ---- COMPLETE (closed out, signed) ----
    {
      id: "P-3000",
      kind: "project",
      quoteId: null,
      name: "Harbor Rep — Orchestra Shell",
      customer: "Harbor Repertory Theatre",
      customerId: null,
      locationId: null,
      owner: pm,
      value: 96000,
      margin: 0.32,
      createdAt: ago(120),
      updatedAt: ago(14),
      startedAt: ago(110),
      targetDate: ago(20),
      installStart: ago(30),
      installEnd: ago(22),
      stage: "complete",
      stageHistory: [],
      procurement: [
        line({ sku: "WN-DIVA", desc: "Diva acoustical shell towers (6)", vendor: "Wenger", qty: 6, unit: "ea", cost: 44000, leadDays: 70, status: "received", orderedAt: ago(100), po: "PO-0980" }),
        line({ sku: "WN-CEIL", desc: "Overhead ceiling panels", vendor: "Wenger", qty: 1, unit: "lot", cost: 16500, leadDays: 70, status: "received", orderedAt: ago(100), po: "PO-0981" }),
      ],
      mobilizations: [],
      deliveries: [
        { id: uid("dl-"), label: "Wenger shell freight", vendor: "Wenger", eta: ago(34), status: "received", receivedAt: ago(34) },
      ],
      crew: [
        { id: uid("cw-"), person: "Nic Trapani", role: "Lead", start: ago(30), end: ago(22) },
      ],
      tasks: [
        { id: uid("tk-"), title: "Assemble towers & set ceiling", section: "Install", assignee: "Nic Trapani", done: true, doneAt: ago(24) },
        { id: uid("tk-"), title: "Train staff on move/store", section: "Closeout", assignee: "Nic Trapani", done: true, doneAt: ago(22) },
      ],
      notes: [],
      timeLogs: [
        { id: uid("tl-"), person: "Nic Trapani", date: ago(28), hours: 40, note: "Install week" },
      ],
      trainingAt: ago(22),
      signoff: {
        name: "Dana Whitfield",
        role: "Facilities Director",
        signedBy: pm,
        signedAt: ago(20),
        note: "Accepted, no punch items.",
      },
    },
  ];
}

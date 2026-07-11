import type {
  FlameJob,
  FlameJobResults,
  FlameJobVenueResult,
} from "@/lib/stores/flame-jobs";

/**
 * Seed flame-test jobs — verbatim port of app/flamejobs.js seedData(): a
 * spread across the lifecycle + renewal states so every view (dashboard,
 * renewals, scheduler, both maps) is populated. Venue coords are embedded
 * so the maps work with no network. A function so the relative dates
 * compute at seed time.
 *
 * Renewal spread (dueAt = completedAt + 1yr, 60-day lead window):
 *   FT-3001 completed 395d ago → overdue
 *   FT-3002 completed 360d ago → due_soon (right at the anniversary)
 *   FT-3003 completed 318d ago → due_soon (inside the 60-day window)
 *   FT-3004 completed  95d ago → ok
 *   FT-3005/3006 scheduled (ahead 9d / 3d) · FT-3007/3008 approved
 */

const DAY = 86400000;
const YEAR = 365 * DAY;

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
function iso(ts: number): string {
  const d = new Date(ts);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function results(
  overall: string,
  cert: string,
  by: string,
  venues: FlameJobVenueResult[],
  note?: string
): FlameJobResults {
  return {
    overall,
    cert: cert || "",
    performedBy: by || "",
    method: "Field flame test per NFPA 705",
    venues: venues || [],
    notes: note || "",
  };
}

function rv(
  id: string,
  label: string,
  tested: number,
  passed: number,
  retreated: number,
  notes?: string
): FlameJobVenueResult {
  return {
    id,
    label,
    tested,
    passed,
    failed: tested - passed - (retreated || 0),
    retreated: retreated || 0,
    treatment: retreated ? "Re-treated on site" : "Passed field test",
    notes: notes || "",
  };
}

type SeedJob = Omit<FlameJob, "createdAt" | "updatedAt" | "dueAt">;

export function flameJobsSeed(): FlameJob[] {
  const list: SeedJob[] = [
    // ---- COMPLETED · OVERDUE (13 months ago) ----
    {
      id: "FT-3001",
      quoteId: "FTQ-1001",
      customer: "Lakefront Performing Arts Center",
      customerId: "lakefront",
      locationId: "lf1",
      venue: "Main Hall",
      value: 640,
      curtainsTotal: 18,
      contact: { name: "Dana Whitlock", role: "Facilities Director", email: "dwhitlock@lakefrontpac.org" },
      venues: [
        { id: "lf1", label: "Main Hall", city: "Milwaukee", state: "WI", lat: 43.043, lng: -87.910, curtains: 18 },
      ],
      stage: "completed",
      assignedTo: "Nic Trapani",
      approvedAt: ago(430),
      scheduledDate: iso(ago(398)),
      completedAt: ago(395),
      results: results(
        "pass",
        "FT-2024-018",
        "Nic Trapani",
        [rv("lf1", "Main Hall", 18, 18, 0)],
        "All soft goods passed the field flame test."
      ),
      owner: "Nic Trapani",
    },
    // ---- COMPLETED · DUE (right at the anniversary, ~360 days ago) ----
    {
      id: "FT-3002",
      quoteId: "FTQ-1002",
      customer: "North Ridge High School",
      customerId: "northridge",
      locationId: "nr1",
      venue: "Main Auditorium",
      value: 385,
      curtainsTotal: 9,
      contact: { name: "Greg Salas", role: "Auditorium Manager", email: "gsalas@northridgehs.edu" },
      venues: [
        { id: "nr1", label: "Main Auditorium", city: "Appleton", state: "WI", lat: 44.300, lng: -88.391, curtains: 9 },
      ],
      stage: "completed",
      assignedTo: "Jason Keagy",
      approvedAt: ago(392),
      scheduledDate: iso(ago(362)),
      completedAt: ago(360),
      results: results(
        "pass",
        "FT-2024-041",
        "Jason Keagy",
        [rv("nr1", "Main Auditorium", 9, 9, 0)],
        "Passed. Grand drape showing age — flag for re-treatment next cycle."
      ),
      owner: "Jason Keagy",
    },
    // ---- COMPLETED · DUE SOON (within the 60-day window, ~318 days ago) ----
    {
      id: "FT-3003",
      quoteId: "FTQ-1003",
      customer: "Northshore Theater",
      customerId: "northshore",
      locationId: "ns1",
      venue: "Main House",
      value: 520,
      curtainsTotal: 14,
      contact: { name: "Susan Marsh", role: "Operations Director", email: "smarsh@northshoretheater.org" },
      venues: [
        { id: "ns1", label: "Main House", city: "Sheboygan", state: "WI", lat: 43.748, lng: -87.711, curtains: 14 },
      ],
      stage: "completed",
      assignedTo: "Nic Trapani",
      approvedAt: ago(350),
      scheduledDate: iso(ago(320)),
      completedAt: ago(318),
      results: results(
        "partial",
        "FT-2024-057",
        "Nic Trapani",
        [rv("ns1", "Main House", 14, 11, 3, "3 legs re-treated on site.")],
        "Three stage-left legs re-treated on site; all passed on re-test."
      ),
      owner: "Nic Trapani",
    },
    // ---- COMPLETED · ON SCHEDULE (3 months ago, not due yet) ----
    {
      id: "FT-3004",
      quoteId: "FTQ-1004",
      customer: "Badger Ballet Company",
      customerId: "badger",
      locationId: "bb1",
      venue: "Main Stage",
      value: 445,
      curtainsTotal: 11,
      contact: { name: "Priya Anand", role: "Production Manager", email: "priya@badgerballet.org" },
      venues: [
        { id: "bb1", label: "Main Stage", city: "Madison", state: "WI", lat: 43.075, lng: -89.391, curtains: 11 },
      ],
      stage: "completed",
      assignedTo: "Jeff Chesebro",
      approvedAt: ago(128),
      scheduledDate: iso(ago(96)),
      completedAt: ago(95),
      results: results(
        "pass",
        "FT-2025-012",
        "Jeff Chesebro",
        [rv("bb1", "Main Stage", 11, 11, 0)],
        "All curtains passed."
      ),
      owner: "Jeff Chesebro",
    },
    // ---- SCHEDULED · upcoming ----
    {
      id: "FT-3005",
      quoteId: "FTQ-1005",
      customer: "Bayfront Arena",
      customerId: "bayfront",
      locationId: "ba1",
      venue: "Arena Floor",
      value: 720,
      curtainsTotal: 8,
      contact: { name: "Derek Cole", role: "Venue Operations", email: "dcole@bayfrontarena.com" },
      venues: [
        { id: "ba1", label: "Arena Floor", city: "Green Bay", state: "WI", lat: 44.502, lng: -88.061, curtains: 8 },
      ],
      stage: "scheduled",
      assignedTo: "Jason Keagy",
      approvedAt: ago(12),
      scheduledDate: iso(ahead(9)),
      completedAt: null,
      results: null,
      owner: "Jason Keagy",
    },
    // ---- SCHEDULED · this week ----
    {
      id: "FT-3006",
      quoteId: "FTQ-1006",
      customer: "Lakeside Community Church",
      customerId: "lakeside",
      locationId: "lc1",
      venue: "Sanctuary",
      value: 260,
      curtainsTotal: 6,
      contact: { name: "Pastor Liam Boyd", role: "Operations", email: "liam@lakesidechurch.org" },
      venues: [
        { id: "lc1", label: "Sanctuary", city: "Oshkosh", state: "WI", lat: 44.052, lng: -88.543, curtains: 6 },
      ],
      stage: "scheduled",
      assignedTo: "Nic Trapani",
      approvedAt: ago(8),
      scheduledDate: iso(ahead(3)),
      completedAt: null,
      results: null,
      owner: "Nic Trapani",
    },
    // ---- APPROVED · awaiting scheduling (2nd venue at an existing customer) ----
    {
      id: "FT-3007",
      quoteId: "FTQ-1007",
      customer: "Lakefront Performing Arts Center",
      customerId: "lakefront",
      locationId: "lf2",
      venue: "Studio Theatre",
      value: 210,
      curtainsTotal: 5,
      contact: { name: "Tom Reyes", role: "Technical Director", email: "treyes@lakefrontpac.org" },
      venues: [
        { id: "lf2", label: "Studio Theatre", city: "Milwaukee", state: "WI", lat: 43.043, lng: -87.910, curtains: 5 },
      ],
      stage: "approved",
      assignedTo: "",
      approvedAt: ago(3),
      scheduledDate: "",
      completedAt: null,
      results: null,
      owner: "Jeff Chesebro",
    },
    // ---- APPROVED · awaiting scheduling ----
    {
      id: "FT-3008",
      quoteId: "FTQ-1008",
      customer: "Badger Ballet Company",
      customerId: "badger",
      locationId: "bb2",
      venue: "Rehearsal Studio",
      value: 190,
      curtainsTotal: 4,
      contact: { name: "Karl Vogt", role: "Head Carpenter", email: "kvogt@badgerballet.org" },
      venues: [
        { id: "bb2", label: "Rehearsal Studio", city: "Madison", state: "WI", lat: 43.075, lng: -89.391, curtains: 4 },
      ],
      stage: "approved",
      assignedTo: "",
      approvedAt: ago(1),
      scheduledDate: "",
      completedAt: null,
      results: null,
      owner: "Jeff Chesebro",
    },
  ];

  const t = now();
  return list.map((j) => ({
    ...j,
    dueAt: j.completedAt != null ? j.completedAt + YEAR : null,
    createdAt: j.approvedAt || t,
    updatedAt: t,
  }));
}

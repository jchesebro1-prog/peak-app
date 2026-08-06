import type {
  Quote,
  QuoteReview,
  QuoteStatus,
  ReviewState,
} from "@/lib/stores/quotes";

/**
 * Seed quotes — verbatim port of app/store.js seedData() (the original mock
 * pipeline), including SEED_CUST customer links and SEED_REVIEWS review
 * states. A function so the relative dates compute at seed time.
 *
 * Q-2042 (Harbor Rep) is intentionally NOT in the Customers directory — it
 * stays unlinked and falls back to its denormalized name, exercising that
 * path.
 */

const DAY = 86400000;
function now(): number {
  return Date.now();
}
function ago(days: number): number {
  return now() - days * DAY;
}

function rv(state: ReviewState, o: Partial<QuoteReview> = {}): QuoteReview {
  return {
    state,
    reviewer: o.reviewer || null,
    submittedBy: o.submittedBy || null,
    submittedAt: o.submittedAt || null,
    decidedBy: o.decidedBy || null,
    decidedAt: o.decidedAt || null,
    note: o.note || "",
  };
}

/** Intended review state per seed quote (store.js SEED_REVIEWS). */
const SEED_REVIEWS: Record<string, () => QuoteReview> = {
  "Q-2041": () => rv("none"),
  "Q-2038": () =>
    rv("approved", {
      reviewer: "Jack Hamilton",
      submittedBy: "Nic Trapani",
      submittedAt: ago(10),
      decidedBy: "Jack Hamilton",
      decidedAt: ago(9),
    }),
  "Q-2033": () =>
    rv("approved", {
      reviewer: "Isaac Mittlesteadt",
      submittedBy: "Jena Tolksdorf",
      submittedAt: ago(7),
      decidedBy: "Isaac Mittlesteadt",
      decidedAt: ago(6),
    }),
  "Q-2035": () =>
    rv("approved", {
      reviewer: "Jack Hamilton",
      submittedBy: "Jeff Chesebro",
      submittedAt: ago(12),
      decidedBy: "Jack Hamilton",
      decidedAt: ago(11),
    }),
  "Q-2030": () =>
    rv("in_review", {
      reviewer: "Jeff Chesebro",
      submittedBy: "Jack Hamilton",
      submittedAt: ago(1),
    }),
  "Q-2027": () =>
    rv("approved", {
      reviewer: "Isaac Mittlesteadt",
      submittedBy: "Jason Keagy",
      submittedAt: ago(21),
      decidedBy: "Isaac Mittlesteadt",
      decidedAt: ago(20),
    }),
  "Q-2042": () =>
    rv("in_review", {
      reviewer: null,
      submittedBy: "Nic Trapani",
      submittedAt: ago(0),
    }),
};

function defaultReview(status: QuoteStatus): QuoteReview {
  return status === "sent" || status === "won" || status === "lost"
    ? rv("approved")
    : rv("none");
}

/** Canonical customer link per seed quote: [customerId, locationId] (store.js SEED_CUST). */
const SEED_CUST: Record<string, readonly [string, string]> = {
  "Q-2041": ["lakefront", "lf1"],
  "Q-2038": ["northridge", "nr1"],
  "Q-2033": ["badger", "bb1"],
  "Q-2035": ["lakeside", "lc1"],
  "Q-2030": ["northshore", "ns1"],
  "Q-2027": ["bayfront", "ba1"],
  "Q-2045": ["lakefront", "lf1"],
};

type SeedBase = {
  id: string;
  name: string;
  customer: string;
  value: number;
  margin: number;
  status: QuoteStatus;
  source: string;
  owner: string;
  createdAt: number;
  updatedAt: number;
  /** Absent on system quotes; "consulting" routes the quote into the
   *  engagement sync (punch #79 needs one so CE-1001 materializes). */
  quoteType?: string;
};

export function quotesSeed(): Quote[] {
  const base: SeedBase[] = [
    { id: "Q-2041", name: "Lakefront PAC — Stage Systems Package", customer: "Lakefront Performing Arts Center", value: 232160, margin: 0.31, status: "draft", source: "estimator", owner: "Jeff Chesebro", createdAt: ago(9), updatedAt: ago(2) },
    { id: "Q-2038", name: "North Ridge HS — Auditorium Rigging Refit", customer: "North Ridge High School", value: 86400, margin: 0.34, status: "sent", source: "estimator", owner: "Nic Trapani", createdAt: ago(14), updatedAt: ago(8) },
    { id: "Q-2033", name: "Badger Ballet — Hoist Automation", customer: "Badger Ballet Company", value: 174900, margin: 0.29, status: "sent", source: "estimator", owner: "Jena Tolksdorf", createdAt: ago(12), updatedAt: ago(5) },
    { id: "Q-2035", name: "Lakeside Community Church — Drapery & Track", customer: "Lakeside Community Church", value: 41720, margin: 0.36, status: "won", source: "quick", owner: "Jeff Chesebro", createdAt: ago(20), updatedAt: ago(9) },
    { id: "Q-2030", name: "Northshore Theater — Counterweight Upgrade", customer: "Northshore Theater", value: 58200, margin: 0.30, status: "draft", source: "quick", owner: "Jack Hamilton", createdAt: ago(8), updatedAt: ago(6) },
    { id: "Q-2027", name: "Bayfront Arena — Scoreboard Hoist", customer: "Bayfront Arena", value: 312500, margin: 0.27, status: "lost", source: "estimator", owner: "Jason Keagy", createdAt: ago(30), updatedAt: ago(17) },
    { id: "Q-2042", name: "Harbor Rep — Orchestra Shell", customer: "Harbor Repertory Theatre", value: 128400, margin: 0.32, status: "draft", source: "estimator", owner: "Nic Trapani", createdAt: ago(2), updatedAt: ago(0) },
    { id: "Q-2045", name: "Lakefront PAC — Systems Consulting & Bid Support", customer: "Lakefront Performing Arts Center", value: 48500, margin: 0.42, status: "won", source: "estimator", owner: "Jack Hamilton", createdAt: ago(24), updatedAt: ago(11), quoteType: "consulting" },
  ];
  return base.map((q): Quote => {
    const sc = SEED_CUST[q.id] || ([null, null] as const);
    const mkReview = SEED_REVIEWS[q.id];
    return {
      ...q,
      customerId: sc[0],
      locationId: sc[1],
      history: [{ at: q.createdAt, to: "draft" }],
      review: mkReview ? mkReview() : defaultReview(q.status),
    };
  });
}

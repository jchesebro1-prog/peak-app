import type { DesignRecord, DesignReview, ReviewState } from "@/lib/stores/designs";

/**
 * Design sandbox seed — exact port of app/sandbox.js seedData() +
 * SEED_REVIEWS: a few exploratory budget plays, distinct from the pipeline.
 * Timestamps are relative to "now" at call time (prototype ago()).
 *
 * The prototype seed designs carry no drawing payload — the opaque `config`
 * blob only appears once the Quick Design screen saves a design — so none
 * is seeded here (ported verbatim: the field is absent).
 */

const DAY = 86400000;

function ago(days: number): number {
  return Date.now() - days * DAY;
}

/** Inline port of sandbox.js rv(state, o). */
function rv(state: ReviewState, o: Partial<DesignReview> = {}): DesignReview {
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

export function designsSeed(): DesignRecord[] {
  // sandbox.js SEED_REVIEWS
  const reviews: Record<string, DesignReview> = {
    "D-104": rv("none"),
    "D-103": rv("in_review", {
      reviewer: "Jeff Chesebro",
      submittedBy: "Isaac Mittlesteadt",
      submittedAt: ago(1),
    }),
    "D-101": rv("approved", {
      reviewer: "Isaac Mittlesteadt",
      submittedBy: "Jeff Chesebro",
      submittedAt: ago(7),
      decidedBy: "Isaac Mittlesteadt",
      decidedAt: ago(6),
    }),
  };
  return [
    {
      id: "D-104",
      customerId: "lakefront",
      locationId: "lf1",
      customer: "Lakefront Performing Arts Center",
      name: "Lakefront PAC — full fly concept",
      venue: "PAC",
      size: "large",
      tier: "best",
      width: 48,
      depth: 34,
      grid: 58,
      owner: "Jeff Chesebro",
      review: reviews["D-104"],
      systems: ["Rigging", "Curtains", "Fixtures", "Controls", "Acoustical Shell", "Pit Filler"],
      budget: 286000,
      updatedAt: ago(1),
    },
    {
      id: "D-103",
      customerId: "northridge",
      locationId: "nr1",
      customer: "North Ridge High School",
      name: "North Ridge HS — gym stage retrofit",
      venue: "School",
      size: "medium",
      tier: "good",
      width: 34,
      depth: 22,
      grid: 22,
      owner: "Isaac Mittlesteadt",
      review: reviews["D-103"],
      systems: ["Curtains", "Fixtures", "Audio"],
      budget: 61500,
      updatedAt: ago(3),
    },
    {
      id: "D-101",
      customerId: "lakefront",
      locationId: "lf2",
      customer: "Lakefront Performing Arts Center",
      name: "Black box flex space — option B",
      venue: "PAC",
      size: "small",
      tier: "better",
      width: 28,
      depth: 26,
      grid: 20,
      owner: "Jeff Chesebro",
      review: reviews["D-101"],
      systems: ["Rigging", "Fixtures", "Controls"],
      budget: 98400,
      updatedAt: ago(6),
    },
  ];
}

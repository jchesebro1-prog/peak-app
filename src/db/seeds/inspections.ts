import {
  blankLog,
  blankRubric,
  renumber,
  type InspectionLog,
  type InspectionRecord,
  type RubricRatingKey,
  type RubricSection,
} from "@/lib/stores/inspections";

/**
 * Inspection seed — verbatim port of seedData(), seedRubric() and seedLogs()
 * from app/inspect.js, including the full pre-rated component-condition
 * rubrics on RI-2042 (complete) and RI-2044 (partial, in-progress walkthrough).
 *
 * Timestamps are relative to Date.now() at call time, exactly like the
 * prototype (ago day offsets). demoInspection() is the port of
 * InspectionStore.demo() — the non-persisted example record the Report
 * screen renders even in an empty app.
 */

const DAY = 86400000;

function now(): number {
  return Date.now();
}
function ago(d: number): number {
  return now() - d * DAY;
}

/**
 * A realistic pre-rated rubric for the demo records (mirrors the
 * Gopher / Rochester field sheet). `partial` leaves later sections
 * unrated to represent an in-progress on-site walkthrough.
 */
export function seedRubric(partial?: boolean): RubricSection[] {
  const rb = blankRubric();
  const set = (
    title: string,
    ratings: RubricRatingKey[],
    comments?: string,
    lineSet?: string
  ): void => {
    const s = rb.find((x) => x.title === title);
    if (!s) return;
    s.items.forEach((it, i) => {
      it.rating =
        ratings[i] !== undefined ? ratings[i] : ratings[ratings.length - 1] || "fair";
    });
    if (comments) s.comments = comments;
    if (lineSet) s.lineSet = lineSet;
  };
  set("Loft Block", ["fair", "fair", "fair", "fair", "fair"], "A mix of original and 1997-era equipment. All are good candidates for replacement due to age and poor condition.", "ALL");
  set("Wire Rope / Terminations", ["fair", "fair", "fair", "fair", "fair"], "All aircraft cable is 20+ years old and requires replacement soon.", "2");
  set("Head Block", ["fair", "fair", "fair", "poor", "fair"], "Head block on set 6 is seized. #5 is out of service due to poor condition; the rest need maintenance or replacement due to age.", "5, 6");
  set("Counterweight Arbor", ["fair", "fair", "fair", "na", "fair", "fair", "fair"], "Several arbors are not safe to use — 5 original arbors do not meet current industry standards. Line set 12 arbor is twisted out of shape; several arbors lack the required spreader plates.", "12");
  set("Counterweights", ["good"]);
  set("Rope Lock", ["fair", "fair", "fair", "fair", "fair"], "Aged equipment, requires replacement soon. Most do not lock properly.", "ALL");
  set("Hand Line", ["fair"], "Worn and frayed. Typical rope lifespan is about 10 years.", "ALL");
  set("Tension Block", ["fair", "fair", "fair", "fair", "fair"]);
  set("Battens", ["fair", "fair"]);
  set("Locking Rail", ["fair", "fair", "fair"]);
  if (!partial) {
    set("Arbor Guide System", ["na", "na", "na", "fair", "fair", "na", "fair"], "Wire-guided arbor system. Arbor stops and guide wires need attention.", "13");
    set("CWT Electrics", ["fair", "poor", "fair", "fair"], "The electric set located under the catwalk over the stage does not meet current industry standards — a life-safety liability concern. Recommend dead-hanging this electric just upstage of the catwalk.", "4");
    set("CWT Other Components", ["na", "fair", "poor"], "Access ladders need proper PPE and a vertical safety-line system.", "");
    set("Curtain", ["fair", "fair", "na", "na", "na", "na", "na", "na", "na"], "All fabrics are dated 1999. Four samples passed the simple burn test but are near the end of retardant effectiveness — re-test in one year.", "");
    set("Track", ["fair", "fair", "fair", "na"], "Dusty; otherwise operational.", "");
  }
  return rb;
}

/** A realistic, mixed set for the demo "completed" inspection. */
export function seedLogs(): InspectionLog[] {
  const L = (o: Partial<InspectionLog>): Partial<InspectionLog> => o;
  const raw: Array<Partial<InspectionLog>> = [
    // URGENT (open)
    L({ severity: "urgent", status: "open", problem: "Access ladder to the loading gallery requires a self-closing gate", location: "SL loading gallery", standards: ["OSHA 1910.28(b)"],
      explanation: "There is a gap in the guardrail at the ladder used to reach the loading gallery, presenting a significant fall hazard. OSHA 1910.28(b) requires that any employee on a walking-working surface with an unprotected edge 4 ft or more above a lower level be protected from falling by guardrails or a personal fall-protection system.",
      solution: "Install a self-closing safety gate at the access opening to protect technicians from the fall hazard.", firstNoted: "2023-12-05" }),
    L({ severity: "urgent", status: "open", problem: "Fire curtain head block uses unrated, undersized hardware", location: "Fire curtain head block", standards: [],
      explanation: "Unrated, undersized hardware mounts the fire-curtain head block. Overhead rigging must use rated locking hardware; the breaking strength of unrated hardware is unknown, and undersized bolts do not fully bear on the surface and can pull through under load.",
      solution: "Replace all unrated hardware with properly sized Grade 5 or higher rated hardware.", firstNoted: "2023-12-05" }),
    L({ severity: "urgent", status: "open", problem: "Guardrail required at the stage-right grid edge", location: "SR grid edge", standards: ["OSHA 1910.28(b)"],
      explanation: "The stage-right edge of the grid is unprotected. Per OSHA 1910.28(b) the top rail must sit 42\" (±3\") above the walking surface with a mid-rail halfway between it and the deck.",
      solution: "Install a compliant top rail, mid-rail, and a self-closing gate to enclose the open edge.", firstNoted: "2023-12-05" }),
    L({ severity: "urgent", status: "open", problem: "Catwalk railings are too low and mid-rails are not present", location: "FOH catwalks", standards: ["OSHA 1910.28(b)"],
      explanation: "The hand rails are too low throughout the catwalk system and no mid-rail is present, below what is allowed for fall prevention under OSHA 1910.28(b).",
      solution: "Install a new top rail and mid-rail to the required heights throughout the catwalks.", firstNoted: "2023-12-05" }),
    L({ severity: "urgent", status: "open", problem: "Line 6 of line set 12 is spiraled", location: "Line set 12", standards: [],
      explanation: "The wire rope for line 6 of line set 12 is spiraled — a visible sign the wire and strands have been twisted tighter than manufactured. This damage can result in unexpected failure.",
      solution: "Replace all wire rope that displays spiraling damage.", firstNoted: "2023-12-05" }),
    L({ severity: "urgent", status: "open", problem: "Rope locks are worn", location: "Operating rail", standards: [],
      explanation: "The rope locks show severe wear, with many cams worn flat. Worn rope locks can let a line set move unexpectedly, resulting in a runaway line set.",
      solution: "Replace the worn rope locks.", firstNoted: "2021-02-10" }),
    L({ severity: "urgent", status: "open", problem: "Fire curtain does not have a deceleration device", location: "Fire curtain", standards: ["ANSI E1.22"],
      explanation: "The fire curtain has no deceleration device. ANSI E1.22 requires the curtain take at least 5 seconds to travel the last 8 ft; without it the curtain can impact the deck at full speed and damage the curtain and rigging.",
      solution: "Install a dashpot or other deceleration device after reviewing the best method with venue staff.", firstNoted: "2023-12-05" }),
    L({ severity: "urgent", status: "open", problem: "Head block beam is showing deflection", location: "Head block steel", standards: [],
      explanation: "The head-block steel is visibly deflecting downward and on-stage. Visible deflection in a structural beam can indicate overloading and risks catastrophic failure.",
      solution: "Have the beam assessed by a qualified structural engineer before any rigging renovation, and develop a remediation plan from that assessment.", firstNoted: "2021-02-10" }),
    // NECESSARY (open)
    L({ severity: "necessary", status: "open", problem: "Single wire rope clips on the guide lines", location: "Arbor guide wires", standards: [],
      explanation: "The guide-wire terminations use a single wire-rope clip. Clips are only rated when used in pairs or more at the correct spacing and torque; a single clip can slip and drop the load.",
      solution: "Replace the wire rope with a length properly terminated using copper compression sleeves.", firstNoted: "2023-12-05" }),
    L({ severity: "necessary", status: "open", problem: "Loft block hardware is unrated", location: "Overstage loft blocks", standards: [],
      explanation: "Unrated hardware secures many of the loft blocks. All rigging equipment must be connected with rated locking hardware; unrated hardware has an unknown breaking strength.",
      solution: "Replace all unrated hardware with Grade 5 or higher rated hardware.", firstNoted: "2023-12-05" }),
    L({ severity: "necessary", status: "open", problem: "Fleet angle is too severe on line set 25", location: "Line set 25", standards: ["ANSI E1.4-1"],
      explanation: "The wire rope runs off the head block on line set 25 at a fleet angle steeper than the 1.5° allowed by ANSI E1.4-1 for 7×19 rope, wearing the sheave edges and the rope.",
      solution: "Adjust head/loft block placement — or add diverting blocks — to bring the fleet angle within tolerance.", firstNoted: "2023-12-05" }),
    L({ severity: "necessary", status: "open", problem: "Shackle pins below the battens are not fixed", location: "Below battens (system-wide)", standards: [],
      explanation: "Screw-pin shackles on the curtain tracks and pipes hung from the battens are not moused. Vibration in use gradually loosens an unfixed pin until it can spin free.",
      solution: "Mouse every screw-pin shackle with steel wire or a zip tie through the pin eye, fastened back to the shackle body.", firstNoted: "2021-02-10" }),
    L({ severity: "necessary", status: "open", problem: "Overhead side-arm fixtures lack secondary safety cables", location: "SL gallery side arms", standards: [],
      explanation: "Side-arm fixtures on the stage-left gallery hang from a single point with no secondary cable. Any single-point overhead unit needs a secondary to catch it if the primary fails.",
      solution: "Install secondary safety cables on all overhead fixtures and monitor during every lighting changeover.", firstNoted: "2023-12-05" }),
    // BASIC (open)
    L({ severity: "basic", status: "open", problem: "Unused sheaves left on the head block steel", location: "Head block steel", standards: [],
      explanation: "Redundant sheaves and hardware remain on the head-block steel. Unused overhead material adds weight and can work loose over time.",
      solution: "Remove all unused sheaves and hardware from the overhead steel.", firstNoted: "2023-12-05" }),
    L({ severity: "basic", status: "open", problem: "No signage indicating system capacities", location: "Operating rail", standards: [],
      explanation: "There is no posted signage for the rigging system’s rated capacities, leaving operators without a reference for safe loading.",
      solution: "Post capacity signage at the operating rail and loading gallery.", firstNoted: "2023-12-05" }),
    // CLOSED (resolved — with work performed + after photo)
    L({ severity: "urgent", status: "closed", problem: "Fire curtain release required breaking glass", location: "Fire curtain release", standards: ["ANSI E1.22", "NFPA 80"],
      explanation: "The fire-curtain quick release was a break-glass system, no longer acceptable under ANSI E1.22 and impossible to fully test annually per NFPA 80 without replacing the glass. First noted during the February 2021 inspection.",
      workPerformed: "As of this inspection the glass has been removed and replaced with plexiglass. This work was performed by venue staff.", firstNoted: "2021-02-10", hasAfter: true }),
    L({ severity: "necessary", status: "closed", problem: "Loose shackle left on a c-channel above the stage", location: "Overstage c-channel", standards: [],
      explanation: "A loose shackle rested on a channel above the stage and could easily have fallen, risking injury or property damage. No loose material should be stored overhead unless secured.",
      workPerformed: "During this inspection our technicians removed the shackle and returned it to venue staff.", firstNoted: "2023-12-05", hasAfter: true }),
  ];
  raw.forEach((l, i) => {
    l.seq = i;
  });
  return renumber(raw.map((l) => blankLog(l)));
}

export function inspectionsSeed(): InspectionRecord[] {
  return [
    // 1) COMPLETED — the rich demo report (Lakefront PAC, Main Hall)
    {
      id: "RI-2042", customer: "Lakefront Performing Arts Center", customerId: "lakefront", locationId: "lf1",
      venue: "Main Hall", venueType: "Proscenium theater", address: "929 N Water St, Milwaukee, WI 53202",
      contact: "Tom Reyes", contactPhone: "(414) 555-0148", contactEmail: "treyes@lakefrontpac.org",
      surveyDate: "2023-12-05", reportDate: "2024-01-26", inspector: "Nic Trapani",
      condition: "poor",
      scope: "(32) single-purchase counterweight line sets, (1) manual-reset fire curtain, all front-of-house catwalks, and all overstage track and drapery.",
      narrative: "The counterweight system in the Main Hall is in poor condition. The system shows a range of issues from poor original design through age-related wear, and would benefit from a full renovation. Of particular concern is visible deflection in the head-block support steel, which should be assessed by a qualified structural engineer before any rigging renovation proceeds. A renovation budget covering the Urgent and Necessary repairs is provided separately from this report.",
      logs: seedLogs(),
      rubric: seedRubric(),
      venueInfo: { yearBuilt: "1968 · rigging renovated 1997", currentUse: "Multi-use proscenium — touring, education, community", ownerConcerns: "General condition and safety of the counterweight system; visible deflection in the head-block support steel.", riggingType: "Single-purchase counterweight", lineSets: "32", liftLines: "4 per set", manufacturer: "Original (1968) & SECOA (1997)", electrics: "4 raceways + 1 dead-hung", fireCurtain: "Manual-reset, single", curtainTrack: "6 tracks + main traveler", orchestraShell: "Acoustic ceiling (line-set stored)", deadHung: "1 electric under the catwalk", pitLift: "Fixed pit — no lift" },
      measurements: { proW: "40′-0″", proH: "22′-0″", depth: "32′-6″", apron: "4′-0″", srW: "18′-0″", slW: "22′-0″", steel: "60′-0″", grid: "58′-0″", houseH: "34′-0″", pit: "8′-6″", deck: "Sprung wood · no traps", beam1: "24′-0″", beam2: "42′-0″", beam3: "60′-0″", beamSpacing: "18′-0″", loadingBridge: "SR · single gallery" },
      priorInspectionId: null, priorSurveyDate: "2021-02-10",
      stage: "completed", assignedTo: "Nic Trapani", scheduledDate: "2023-12-05",
      requestedBy: "Jeff Chesebro", requestedAt: ago(70),
      owner: "Nic Trapani", createdAt: ago(70), updatedAt: ago(6),
      syncState: "synced", syncedAt: ago(6), rev: 8,
    },
    // 2) ON-SITE — capture in progress (Badger Ballet), a few logs
    {
      id: "RI-2044", customer: "Badger Ballet Company", customerId: "badger", locationId: "bb1",
      venue: "Main Stage", venueType: "Proscenium theater", address: "2201 Atwood Ave, Madison, WI 53704",
      contact: "Karl Vogt", contactPhone: "(608) 555-0127", contactEmail: "kvogt@badgerballet.org",
      surveyDate: "2026-07-01", reportDate: "", inspector: "Jeff Chesebro",
      condition: "fair",
      scope: "(24) single-purchase line sets and the overstage electrics.",
      narrative: "",
      logs: renumber([
        blankLog({ severity: "urgent", status: "open", problem: "Rope locks are worn", location: "Operating rail", seq: 0,
          explanation: "The rope locks show wear with several cams worn flat, which can let a line set move unexpectedly.", solution: "Replace the worn rope locks.", firstNoted: "2026-07-01" }),
        blankLog({ severity: "necessary", status: "open", problem: "Shackle pins below the battens are not fixed", location: "Below battens", seq: 1,
          explanation: "Screw-pin shackles below the battens are not moused and can loosen under vibration.", solution: "Mouse every screw-pin shackle with steel wire or a zip tie.", firstNoted: "2026-07-01" }),
      ]),
      priorInspectionId: null, priorSurveyDate: "",
      rubric: seedRubric(true),
      venueInfo: { yearBuilt: "1990s", currentUse: "Resident ballet & dance company", ownerConcerns: "Insurance-required annual rigging inspection.", riggingType: "Single-purchase counterweight", lineSets: "24", liftLines: "5 per set", manufacturer: "SECOA", electrics: "3 raceways", fireCurtain: "None", curtainTrack: "Main traveler + 2 tracks", orchestraShell: "", deadHung: "", pitLift: "" },
      measurements: { proW: "38′-0″", proH: "20′-0″", depth: "28′-0″", apron: "3′-6″", srW: "16′-0″", slW: "16′-0″", steel: "42′-0″", grid: "40′-0″", houseH: "", pit: "None", deck: "", beam1: "22′-0″", beam2: "40′-0″", beam3: "", beamSpacing: "18′-0″", loadingBridge: "" },
      stage: "onsite", assignedTo: "Jeff Chesebro", scheduledDate: "2026-07-01",
      requestedBy: "Nic Trapani", requestedAt: ago(4),
      owner: "Jeff Chesebro", createdAt: ago(4), updatedAt: ago(0),
      syncState: "pending", syncedAt: null, rev: 3,
    },
    // 3) SCHEDULED — assigned, dated, no logs yet (North Ridge HS)
    {
      id: "RI-2045", customer: "North Ridge High School", customerId: "northridge", locationId: "nr1",
      venue: "Main Auditorium", venueType: "Proscenium theater", address: "1515 E Newberry St, Appleton, WI 54915",
      contact: "Greg Salas", contactPhone: "(920) 555-0176", contactEmail: "gsalas@northridgehs.edu",
      surveyDate: "2026-07-09", reportDate: "", inspector: "Nic Trapani",
      condition: "fair", scope: "Annual inspection — counterweight system and FOH positions.", narrative: "",
      logs: [],
      priorInspectionId: null, priorSurveyDate: "2025-07-11",
      stage: "scheduled", assignedTo: "Nic Trapani", scheduledDate: "2026-07-09",
      requestedBy: "Jeff Chesebro", requestedAt: ago(6),
      owner: "Nic Trapani", createdAt: ago(6), updatedAt: ago(2),
      syncState: "synced", syncedAt: ago(2), rev: 2,
    },
    // 4) REQUESTED — office brief, awaiting scheduling (Northshore Theater)
    {
      id: "RI-2046", customer: "Northshore Theater", customerId: "northshore", locationId: "ns1",
      venue: "Main House", venueType: "Proscenium theater", address: "618 N 8th St, Sheboygan, WI 53081",
      contact: "Susan Marsh", contactPhone: "(920) 555-0155", contactEmail: "smarsh@northshoretheater.org",
      surveyDate: "", reportDate: "", inspector: "",
      condition: "fair", scope: "Insurance-required annual rigging inspection.", narrative: "",
      logs: [],
      priorInspectionId: null, priorSurveyDate: "",
      stage: "requested", assignedTo: "", scheduledDate: "",
      requestedBy: "Jeff Chesebro", requestedAt: ago(1),
      owner: "Jeff Chesebro", createdAt: ago(1), updatedAt: ago(1),
      syncState: "pending", syncedAt: null, rev: 1,
    },
  ];
}

/** Port of InspectionStore.demo() — the non-persisted demo record so the
 *  Report always renders an example even in an empty app. */
export function demoInspection(): InspectionRecord {
  return inspectionsSeed()[0];
}

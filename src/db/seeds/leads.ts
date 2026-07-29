import { act, mkLead, type LeadRecord } from "@/lib/stores/leads";

/**
 * Lead seed — exact port of app/lead.js seedData() (rss_leads_v1).
 * Relative dates are computed at call time so the demo pipeline always
 * shows a live SLA clock, an overdue follow-up, and a stale lead.
 */
export function leadsSeed(): LeadRecord[] {
  const DAY = 86400000;
  const now = Date.now();
  const ago = (d: number) => now - d * DAY;
  const hrs = (h: number) => now - h * 3600000;

  const JE = "Jeff Chesebro",
    NIC = "Nic Trapani",
    CHRIS = "Chris Mittlesteadt",
    JASON = "Jason Keagy";

  return [
    // ---- NEW, website, SLA clock still ticking (~3h of 24) — the happy path ----
    mkLead({
      id: "L-1061",
      org: "Cedar Grove Middle School",
      contact: "Megan Ortiz",
      email: "mortiz@cedargrove.k12.wi.us",
      phone: "(920) 555-0142",
      city: "Cedar Grove",
      state: "WI",
      source: "website",
      stage: "new",
      owner: "",
      interest: "Gymnasium fly system + new curtain track",
      timeline: "Next budget year",
      value: 34000,
      message:
        "We have a gym-a-torium with an old fly system that needs attention, and possibly a new curtain track. Do you handle school gymnasiums, and how would we start?",
      createdAt: hrs(3),
      activities: [act(hrs(3), "system", "", "Website quote request received")],
    }),

    // ---- NEW, website, SLA BREACHED (~31h, still nobody assigned) — the hero "nothing goes cold" case ----
    mkLead({
      id: "L-1060",
      org: "Maple Ridge Community Theatre",
      contact: "Alan Petrie",
      email: "alan@mapleridgetheatre.org",
      phone: "(608) 555-0173",
      city: "Baraboo",
      state: "WI",
      source: "website",
      stage: "new",
      owner: "",
      interest: "Replace main rag + border/leg set, rig 4 new line sets",
      timeline: "This summer",
      value: 58000,
      message:
        "Our 250-seat house is planning a rigging refresh before our fall season. Could we get a quote for new soft goods and a few line sets? We are hoping to schedule a walk-through soon.",
      createdAt: hrs(31),
      activities: [act(hrs(31), "system", "", "Website quote request received")],
    }),

    // ---- NEW, phone, unassigned, ~6h ----
    mkLead({
      id: "L-1059",
      org: "Grace Fellowship Church",
      contact: "Pastor Ray Nolan",
      email: "office@gracefellowshipwi.org",
      phone: "(414) 555-0198",
      city: "Waukesha",
      state: "WI",
      source: "phone",
      stage: "new",
      owner: "",
      interest: "Motorized front projection screen + AV rigging",
      timeline: "Fall",
      value: 22000,
      message:
        "Called the office — wants a motorized screen and some rigging for a new sanctuary AV setup. Front desk took the message.",
      createdAt: hrs(6),
      activities: [
        act(
          hrs(6),
          "call",
          "Front desk",
          "Inbound call — took message, wants a quote for a motorized screen + AV rigging."
        ),
      ],
    }),

    // ---- CONTACTED, referral, next action tomorrow (on track) ----
    mkLead({
      id: "L-1058",
      org: "Fox Valley Performing Arts",
      contact: "Diane Kohl",
      email: "dkohl@fvpa.org",
      phone: "(920) 555-0110",
      city: "Appleton",
      state: "WI",
      source: "referral",
      stage: "contacted",
      owner: NIC,
      interest: "Orchestra shell + acoustic banners",
      timeline: "Next year (planning)",
      value: 145000,
      message:
        "Referred by North Ridge HS. Exploring an orchestra shell and motorized acoustic banners for their main hall.",
      createdAt: ago(4),
      firstContactAt: ago(3),
      nextActionAt: now + DAY,
      nextActionNote: "Send capabilities deck + rough range",
      activities: [
        act(ago(4), "system", "", "Referred by North Ridge High School"),
        act(ago(3), "email", NIC, "Intro email sent — thanks for the referral, asked for room dims + timeline."),
        act(ago(1), "email", "Diane Kohl", "Replied with drawings attached; wants a budgetary range before the board meeting."),
      ],
    }),

    // ---- QUALIFIED, phone, next action OVERDUE (needs follow-up) ----
    mkLead({
      id: "L-1057",
      org: "Riverside Playhouse",
      contact: "Tom Bishop",
      email: "tbishop@riversideplayhouse.org",
      phone: "(608) 555-0156",
      city: "La Crosse",
      state: "WI",
      source: "phone",
      stage: "qualified",
      owner: JE,
      interest: "Counterweight rigging inspection + repairs",
      timeline: "ASAP",
      value: 41000,
      message:
        "Walk-in at the shop. Has an aging counterweight system, wants an inspection and a repair quote.",
      createdAt: ago(9),
      firstContactAt: ago(9),
      nextActionAt: ago(2),
      nextActionNote: "Call back to book the inspection date",
      activities: [
        act(ago(9), "meeting", JE, "Stopped by the shop — walked through the system, clearly qualified. Wants an inspection then a repair quote."),
        act(ago(6), "call", JE, "Left voicemail to schedule the inspection."),
      ],
    }),

    // ---- CONTACTED, event, STALE (no touch in 8 days → going cold) ----
    mkLead({
      id: "L-1056",
      org: "Northwoods Arts Council",
      contact: "Beth Carlson",
      email: "beth@northwoodsarts.org",
      phone: "(715) 555-0121",
      city: "Rhinelander",
      state: "WI",
      source: "event",
      stage: "contacted",
      owner: CHRIS,
      interest: "New black box theatre — full rigging + drapery package",
      timeline: "Grant-dependent",
      value: 96000,
      message:
        "Met at the WI School Music Association conference. Planning a new black box; grant funding pending.",
      createdAt: ago(14),
      firstContactAt: ago(12),
      nextActionAt: null,
      activities: [
        act(ago(14), "system", "", "Met at WSMA conference — badge scan"),
        act(ago(12), "email", CHRIS, "Follow-up email with our black-box case studies."),
      ],
    }),

    // ---- QUALIFIED, existing customer expansion ----
    mkLead({
      id: "L-1055",
      org: "Lakefront Performing Arts Center",
      contact: "Dana Whitlock",
      email: "dwhitlock@lakefrontpac.org",
      phone: "(414) 555-0134",
      city: "Milwaukee",
      state: "WI",
      source: "existing",
      stage: "qualified",
      owner: JE,
      interest: "Phase 2 — studio theatre motorized rigging",
      timeline: "After Phase 1 install",
      value: 120000,
      customerId: "lakefront",
      message:
        "Existing customer (Phase 1 in flight). Dana asked about a Phase 2 for the studio theatre.",
      createdAt: ago(6),
      firstContactAt: ago(6),
      nextActionAt: now + 2 * DAY,
      nextActionNote: "Scope Phase 2 after Phase 1 survey",
      activities: [
        act(ago(6), "system", JE, "Expansion opportunity flagged from Phase 1 conversation"),
        act(ago(5), "meeting", JE, "Discussed Phase 2 scope on the Phase 1 site visit."),
      ],
    }),

    // ---- QUOTED (converted → linked quote), referral ----
    mkLead({
      id: "L-1053",
      org: "Prairie Line Playhouse",
      contact: "Owen Frisch",
      email: "owen@prairielineplayhouse.com",
      phone: "(608) 555-0187",
      city: "Janesville",
      state: "WI",
      source: "referral",
      stage: "quoted",
      owner: NIC,
      interest: "Single batten replacement + safety check",
      timeline: "A dark Monday",
      value: 2000,
      customerId: "prairieline",
      convertedCustomerId: "prairieline",
      convertedQuoteId: "Q-2043",
      convertedAt: ago(2),
      message: "Bent batten after a load shift. Wants a swap on a dark Monday.",
      createdAt: ago(5),
      firstContactAt: ago(4),
      activities: [
        act(ago(5), "system", "", "Referred in via info@ inbox"),
        act(ago(4), "email", NIC, "Sent ballpark $1,400–$2,200; asked for a dark-Monday date."),
        act(ago(2), "system", NIC, "Converted to customer + quote Q-2043"),
      ],
    }),

    // ---- WON (converted, quote won) ----
    mkLead({
      id: "L-1050",
      org: "St. Meinrad Chapel",
      contact: "Brother Paul",
      email: "paul@stmeinradchapel.org",
      phone: "(920) 555-0165",
      city: "Fond du Lac",
      state: "WI",
      source: "website",
      stage: "won",
      owner: JASON,
      interest: "Chancel drapery + track",
      timeline: "Completed",
      value: 18500,
      customerId: "stmeinrad",
      convertedCustomerId: "stmeinrad",
      convertedQuoteId: "Q-2039",
      convertedAt: ago(24),
      message: "Website request for chancel drapery and a new track.",
      createdAt: ago(30),
      firstContactAt: ago(29),
      activities: [
        act(ago(30), "system", "", "Website quote request received"),
        act(ago(29), "email", JASON, "Sent options for chancel drapery + track."),
        act(ago(24), "system", JASON, "Converted to customer + quote Q-2039"),
        act(ago(12), "system", JASON, "Quote Q-2039 marked WON"),
      ],
    }),

    // ---- LOST (price), phone ----
    mkLead({
      id: "L-1052",
      org: "Bayside Event Center",
      contact: "Rick Mason",
      email: "rmason@baysideevents.com",
      phone: "(414) 555-0102",
      city: "Green Bay",
      state: "WI",
      source: "phone",
      stage: "lost",
      owner: JASON,
      interest: "Portable stage + pipe & drape rental",
      timeline: "One-off",
      value: 9000,
      lostReason: "Wanted rental only — not our line of business",
      message:
        "Called about renting a portable stage and pipe & drape for a one-time gala.",
      createdAt: ago(11),
      firstContactAt: ago(11),
      activities: [
        act(ago(11), "call", JASON, "Only wants a one-time rental, not a sale/install."),
        act(ago(10), "system", JASON, "Marked lost — out of scope (rental only)."),
      ],
    }),

    // ---- NEW, manual (rep-logged), unassigned, fresh ----
    mkLead({
      id: "L-1062",
      org: "Hillside Academy",
      contact: "Karen Doss",
      email: "kdoss@hillsideacademy.org",
      phone: "(715) 555-0149",
      city: "Eau Claire",
      state: "WI",
      source: "manual",
      stage: "new",
      owner: "",
      interest: "Auditorium stage lighting position + rigging assessment",
      timeline: "Exploratory",
      value: 27000,
      message:
        "Principal mentioned at a district event that their auditorium needs a rigging assessment. Logged for follow-up.",
      createdAt: hrs(20),
      activities: [
        act(
          hrs(20),
          "note",
          JE,
          "Heard from the principal at a district event — auditorium needs a rigging + lighting-position assessment."
        ),
      ],
    }),
  ];
}

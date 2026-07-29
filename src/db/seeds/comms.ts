import type { CommThread } from "@/lib/stores/comms";

/**
 * Comm thread seeds — verbatim port of app/comm.js seedData()
 * (localStorage key rss_comms_v2): Jeff's personal inbox, the Sales /
 * Installs / Info shared mailboxes, one draft, and the call & meeting
 * log entries. Timestamps are relative to seed time, epoch-ms, exactly
 * like the prototype's now()/ago()/hrs() helpers.
 */

const DAY = 86400000;
function now() {
  return Date.now();
}
function ago(d: number) {
  return now() - d * DAY;
}
function hrs(h: number) {
  return now() - h * 3600000;
}
function mid(n: number) {
  return "m" + n + "-" + Math.random().toString(36).slice(2, 6);
}

export function commsSeed(): CommThread[] {
  return [
    // ===== Jeff's PERSONAL inbox =========================================
    // Lakefront — questions on Phase 1 quote → WAITING ON US (~20h), unread
    {
      id: "C-1032", mailbox: "personal", mailboxUser: "Jeff Chesebro", unread: true,
      customerId: "lakefront", customer: "Lakefront Performing Arts Center",
      contactName: "Dana Whitlock", contactEmail: "dwhitlock@lakefrontpac.org",
      subject: "Phase 1 Stage Systems quote — a couple questions", channel: "email",
      status: "waiting_us", assignedTo: "Jeff Chesebro",
      link: { type: "quote", id: "Q-2041", label: "Q-2041 · Stage Systems Package — Phase 1" },
      messages: [
        { id: mid(1), at: ago(2), direction: "out", channel: "email", author: "Jeff Chesebro", body: "Hi Dana — attached is the Phase 1 Stage Systems quote (Q-2041). Happy to walk the committee through any line item before your meeting." },
        { id: mid(2), at: hrs(20), direction: "in", channel: "email", author: "Dana Whitlock", body: "Thanks Jeff. Two questions before the committee meets Thursday: what’s the lead time on the counterweight sets, and is the 40% deposit due at acceptance or at delivery?" },
      ],
      createdAt: ago(2), updatedAt: hrs(20), syncState: "synced", syncedAt: hrs(19), rev: 2,
    },
    // Lakeside — voicemail wants to schedule the walk-through → WAITING ON US (~5h), CALL, unread
    {
      id: "C-1029", mailbox: "personal", mailboxUser: "Jeff Chesebro", unread: true,
      customerId: "lakeside", customer: "Lakeside Community Church",
      contactName: "Pastor Liam Boyd", contactEmail: "liam@lakesidechurch.org",
      subject: "Scheduling the sanctuary walk-through", channel: "call",
      status: "waiting_us", assignedTo: "Jeff Chesebro",
      link: { type: "survey", id: "FS-1055", label: "FS-1055 · Sanctuary site survey" },
      messages: [
        { id: mid(1), at: hrs(5), direction: "in", channel: "call", author: "Pastor Liam Boyd", body: "Voicemail: the building committee is ready to schedule the walk-through. Prefers a Tuesday or Thursday morning in the next couple weeks. Call the church office back at (920) 555-0198." },
      ],
      createdAt: hrs(5), updatedAt: hrs(5), syncState: "synced", syncedAt: hrs(4), rev: 1,
    },
    // Lakefront — committee approved → REPLIED (read)
    {
      id: "C-1026", mailbox: "personal", mailboxUser: "Jeff Chesebro", unread: false,
      customerId: "lakefront", customer: "Lakefront Performing Arts Center",
      contactName: "Dana Whitlock", contactEmail: "dwhitlock@lakefrontpac.org",
      subject: "Committee approved Phase 1!", channel: "email",
      status: "replied", assignedTo: "Jeff Chesebro", link: null,
      messages: [
        { id: mid(1), at: ago(7), direction: "in", channel: "email", author: "Dana Whitlock", body: "Great news — the committee approved Phase 1 at last night’s meeting. What do you need from us to get started?" },
        { id: mid(2), at: ago(7), direction: "out", channel: "email", author: "Jeff Chesebro", body: "Wonderful, congratulations! I’ll get the paperwork started today and reach out to schedule the install survey. Expect a deposit invoice and a survey request from our field team shortly." },
      ],
      createdAt: ago(7), updatedAt: ago(7), syncState: "synced", syncedAt: ago(7), rev: 2,
    },
    // Jeff's DRAFT reply (personal · Drafts)
    {
      id: "C-1021", mailbox: "personal", mailboxUser: "Jeff Chesebro", unread: false,
      customerId: "northshore", customer: "Northshore Theater",
      contactName: "Susan Marsh", contactEmail: "smarsh@northshoretheater.org",
      subject: "Re: Counterweight upgrade — revised timeline", channel: "email",
      status: "draft", assignedTo: "Jeff Chesebro", link: { type: "quote", id: "Q-2030", label: "Q-2030 · Counterweight Upgrade" },
      draft: { to: "smarsh@northshoretheater.org", cc: "", subject: "Re: Counterweight upgrade — revised timeline", body: "Hi Susan,\n\nFollowing up with the revised timeline we discussed. If the board can approve by the end of the month we can still hit the summer install window —" },
      messages: [],
      createdAt: hrs(3), updatedAt: hrs(3), syncState: "synced", syncedAt: hrs(3), rev: 1,
    },

    // ===== SALES shared mailbox ==========================================
    // North Ridge HS — PO routing → WAITING ON US (~3d, oldest), Nic, unread
    {
      id: "C-1031", mailbox: "sales", unread: true,
      customerId: "northridge", customer: "North Ridge High School",
      contactName: "Greg Salas", contactEmail: "gsalas@northridgehs.edu",
      subject: "PO timeline for the auditorium refit", channel: "email",
      status: "waiting_us", assignedTo: "Nic Trapani",
      link: { type: "quote", id: "Q-2038", label: "Q-2038 · Auditorium Rigging Refit" },
      messages: [
        { id: mid(1), at: ago(6), direction: "out", channel: "email", author: "Nic Trapani", body: "Greg — sending over the refit quote (Q-2038). Let me know how you’d like the alternates broken out for the district." },
        { id: mid(2), at: ago(3), direction: "in", channel: "email", author: "Greg Salas", body: "Purchasing has to route the PO through district procurement — can you hold pricing for 3 weeks while it clears? Also need a current W-9 for vendor setup." },
      ],
      createdAt: ago(6), updatedAt: ago(3), syncState: "synced", syncedAt: ago(3), rev: 2,
    },
    // Badger Ballet — noise spec answered → WAITING ON THEM, Chris
    {
      id: "C-1030", mailbox: "sales", unread: false,
      customerId: "badger", customer: "Badger Ballet Company",
      contactName: "Priya Anand", contactEmail: "priya@badgerballet.org",
      subject: "Noise level at the hoist under load", channel: "email",
      status: "waiting_them", assignedTo: "Chris Mittlesteadt",
      link: { type: "quote", id: "Q-2033", label: "Q-2033 · Hoist Automation" },
      messages: [
        { id: mid(1), at: ago(5), direction: "in", channel: "email", author: "Priya Anand", body: "Before we sign off on the automation — what’s the measured noise level at the hoist while it’s running? We can’t have it audible during quiet rehearsal passages." },
        { id: mid(2), at: ago(4), direction: "out", channel: "email", author: "Chris Mittlesteadt", body: "Good question. We measured 42 dBA at 10 ft under full load — spec sheet attached. That’s well under a typical rehearsal ambient of ~50 dBA. Happy to demo a unit if that helps the sign-off." },
      ],
      createdAt: ago(5), updatedAt: ago(4), syncState: "synced", syncedAt: ago(4), rev: 2,
    },
    // Northshore — budget check-in → WAITING ON THEM, Isaac
    {
      id: "C-1028", mailbox: "sales", unread: false,
      customerId: "northshore", customer: "Northshore Theater",
      contactName: "Susan Marsh", contactEmail: "smarsh@northshoretheater.org",
      subject: "Counterweight upgrade — budget check-in", channel: "email",
      status: "waiting_them", assignedTo: "Isaac Mittlesteadt",
      link: { type: "quote", id: "Q-2030", label: "Q-2030 · Counterweight Upgrade" },
      messages: [
        { id: mid(1), at: ago(2), direction: "out", channel: "email", author: "Isaac Mittlesteadt", body: "Hi Susan — just checking in on the counterweight upgrade quote. Any feedback from the board, or questions I can get ahead of? Happy to hold our current pricing through the end of the month." },
      ],
      createdAt: ago(2), updatedAt: ago(2), syncState: "synced", syncedAt: ago(2), rev: 1,
    },
    // Bayfront Arena — lost-bid debrief → CLOSED, Jason, MEETING
    {
      id: "C-1025", mailbox: "sales", unread: false,
      customerId: "bayfront", customer: "Bayfront Arena",
      contactName: "Derek Cole", contactEmail: "dcole@bayfrontarena.com",
      subject: "Debrief: scoreboard hoist bid", channel: "meeting",
      status: "closed", assignedTo: "Jason Keagy",
      link: { type: "quote", id: "Q-2027", label: "Q-2027 · Scoreboard Hoist" },
      messages: [
        { id: mid(1), at: ago(18), direction: "out", channel: "meeting", author: "Jason Keagy", body: "Met with Derek to debrief the scoreboard hoist bid. They went with a national integrator on price. Relationship is good — he expects to re-bid next fiscal year and will bring us in early. Action: keep warm, check back in Q1." },
      ],
      createdAt: ago(18), updatedAt: ago(16), syncState: "synced", syncedAt: ago(16), rev: 1,
    },

    // ===== INSTALLS shared mailbox =======================================
    // Badger Ballet — COI request → WAITING ON US (~28h), Chris, unread
    {
      id: "C-1027", mailbox: "installs", unread: true,
      customerId: "badger", customer: "Badger Ballet Company",
      contactName: "Priya Anand", contactEmail: "priya@badgerballet.org",
      subject: "Certificate of insurance before mobilization", channel: "email",
      status: "waiting_us", assignedTo: "Chris Mittlesteadt", link: null,
      messages: [
        { id: mid(1), at: hrs(28), direction: "in", channel: "email", author: "Priya Anand", body: "Facilities is asking for a certificate of insurance naming Badger Ballet as additional insured before your crew mobilizes. Can you have your carrier send one over this week?" },
      ],
      createdAt: hrs(28), updatedAt: hrs(28), syncState: "synced", syncedAt: hrs(27), rev: 1,
    },
    // North Ridge HS — install-window call recap → CLOSED, Nic, CALL
    {
      id: "C-1024", mailbox: "installs", unread: false,
      customerId: "northridge", customer: "North Ridge High School",
      contactName: "Greg Salas", contactEmail: "gsalas@northridgehs.edu",
      subject: "Call recap: summer install window", channel: "call",
      status: "closed", assignedTo: "Nic Trapani", link: null,
      messages: [
        { id: mid(1), at: ago(9), direction: "out", channel: "call", author: "Nic Trapani", body: "Call recap: install has to happen in the summer window (June–Aug) while school is out. Greg will release the PO after the July board meeting. No action needed until the quote is approved." },
      ],
      createdAt: ago(9), updatedAt: ago(9), syncState: "synced", syncedAt: ago(9), rev: 1,
    },

    // ===== INFO shared mailbox (general inbound, mostly unclaimed) ========
    // New website inquiry → WAITING ON US (~2h), unassigned, unread
    {
      id: "C-1023", mailbox: "info", unread: true,
      customerId: null, customer: "Cedar Grove Middle School",
      contactName: "Megan Ortiz", contactEmail: "mortiz@cedargrove.k12.wi.us",
      subject: "Do you install rigging in gymnasiums?", channel: "email",
      status: "waiting_us", assignedTo: "", link: null,
      messages: [
        { id: mid(1), at: hrs(2), direction: "in", channel: "email", author: "Megan Ortiz", body: "Hi — found you through the state theater association. We have a gym-a-torium with an old fly system that needs attention, and possibly a new curtain track. Do you handle school gymnasiums, and how would we start? Thanks!" },
      ],
      createdAt: hrs(2), updatedAt: hrs(2), syncState: "synced", syncedAt: hrs(1), rev: 1,
    },
    // Batten replacement pricing → REPLIED (claimed from info by Jeff)
    {
      id: "C-1022", mailbox: "info", unread: false,
      customerId: null, customer: "Prairie Line Playhouse",
      contactName: "Owen Frisch", contactEmail: "owen@prairielineplayhouse.com",
      subject: "Ballpark for a single batten replacement", channel: "email",
      status: "replied", assignedTo: "Jeff Chesebro", link: null,
      messages: [
        { id: mid(1), at: ago(3), direction: "in", channel: "email", author: "Owen Frisch", body: "One of our battens is bent after a load shifted. Any ballpark to swap a single 42′ batten, and could you do it on a dark Monday?" },
        { id: mid(2), at: hrs(30), direction: "out", channel: "email", author: "Jeff Chesebro", body: "Thanks for reaching out, Owen. A single-batten swap on an existing set typically runs $1,400–$2,200 installed depending on pipe and access. A dark-Monday visit is very doable. I’ll send a short survey form so we can firm it up." },
      ],
      createdAt: ago(3), updatedAt: hrs(30), syncState: "synced", syncedAt: hrs(29), rev: 2,
    },
  ];
}

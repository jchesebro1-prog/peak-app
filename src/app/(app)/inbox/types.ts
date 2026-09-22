/**
 * Inbox view models — serialized on the server (page.tsx) for the client
 * components. All colors/labels are precomputed server-side because the
 * comms store (db-backed) can never be imported into a client bundle.
 */

export type Opt = { value: string; label: string };

export type ChanIcon = "mail" | "phone" | "calendar";

export type FolderRowVM = {
  key: string;
  label: string;
  active: boolean;
  /** 0 → count hidden */
  count: number;
  /** accent = inbox-unread pill, red = needs-reply pill, plain = grey count */
  badge: "accent" | "red" | "plain";
  href: string;
  icon: string; // folder glyph kind
};

/** Real Gmail connection state for the signed-in user's mailbox — replaces the
 *  hardcoded green "Connected" dot, which said the same thing whether or not a
 *  mailbox had ever been authorized. */
export type ConnectionVM = {
  /** off = GMAIL_ENABLED not set (local mail only, nothing to connect);
   *  none = enabled but this user has never authorized a mailbox;
   *  stale = authorized, but the grant predates gmail.modify (needs reconnect);
   *  ok = authorized with full scope. */
  state: "off" | "none" | "stale" | "ok";
  label: string;
  /** second line — the authorized address, or why there isn't one */
  detail: string;
  color: string;
  /** connect/reconnect link; "" when the state offers no action */
  actionHref: string;
  actionLabel: string;
  /** whether Send / Receive can actually reach Gmail */
  canSync: boolean;
  /** "" until the first sync completes */
  lastSync: string;
};

export type SidebarVM = {
  personal: {
    label: string; // "Jeff (me)"
    address: string;
    color: string;
    initials: string;
  };
  personalFolders: FolderRowVM[];
  views: FolderRowVM[];
  leadFollowCount: number;
  forwardAddr: string;
  connection: ConnectionVM;
};

/** A real file on a message (IDEAS #36) — dataUrl doubles as the download href. */
export type AttachmentVM = {
  name: string;
  mime: string;
  size: number;
  dataUrl: string;
};

/** Composer-side attachment chip (no bytes shipped to the client). */
export type AttachmentMetaVM = {
  name: string;
  size: number;
};

export type DraftPayload = {
  mailbox: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  customerId: string;
  contactName: string;
  attachments?: AttachmentMetaVM[];
};

export type ThreadRowVM = {
  id: string;
  unread: boolean;
  isDraft: boolean;
  flagged: boolean;
  pinned: boolean;
  /** category preset color, "" when none */
  categoryColor: string;
  categoryLabel: string;
  name: string;
  /** count of messages[] on the underlying thread; badge hidden when <= 1 */
  msgCount: number;
  /** unique message authors beyond a single-author thread, e.g. "Jeff, Sarah +1"; "" when <= 1 author */
  participants: string;
  subject: string;
  snippet: string;
  time: string;
  waitingUs: boolean;
  chan: ChanIcon;
  showStatus: boolean;
  statusLabel: string;
  statusInk: string;
  statusSoft: string;
  statusBd: string;
  showWait: boolean;
  waitLabel: string;
  showQueued: boolean;
  showBoxTag: boolean;
  boxTag: string;
  boxColor: string;
  showAssignee: boolean;
  assignee: string;
  assigneeInitials: string;
  assigneeColor: string;
  /** lower-cased search haystack: customer/subject/contact/email/snippet */
  haystack: string;
  /** present on drafts rows — opens the composer prefilled */
  draft: DraftPayload | null;
};

export type MessageVM = {
  id: string;
  author: string;
  initials: string;
  color: string;
  out: boolean;
  tag: string;
  queued: boolean;
  time: string;
  body: string;
  attachments?: AttachmentVM[];
};

export type LinkVM = {
  type: string;
  kindLabel: string;
  label: string;
  color: string;
  href: string;
};

export type ReaderVM = {
  id: string;
  unread: boolean;
  /** Thread is out of the inbox (locally archived OR archived on the Gmail
   *  side) — drives the Archive/Unarchive toggle. Unarchive clears the local
   *  flag and, with two-way archive (D74), pushes INBOX back onto the Gmail
   *  thread, so it works for both kinds. */
  archived: boolean;
  subject: string;
  status: string;
  statusLabel: string;
  statusInk: string;
  statusSoft: string;
  statusBd: string;
  waitingUs: boolean;
  waitLabel: string;
  isEmail: boolean;
  chanLabel: string;
  chanIcon: ChanIcon;
  boxLabel: string;
  boxAddress: string;
  boxColor: string;
  contactName: string;
  contactEmail: string;
  contactInitials: string;
  contactColor: string;
  assignedTo: string;
  messages: MessageVM[];
  link: LinkVM | null;
  resolvedCustomerId: string | null;
  resolvedCustomerName: string;
  /** thread.customerId is empty but the contact email resolved a customer —
   *  picking a record also adopts the customer onto the thread */
  needsAdopt: boolean;
  linkOptions: Record<"quote" | "survey" | "inspection" | "project", Opt[]>;
  /** Schedule-site-visit modal data (D76) — present when a customer resolved. */
  visit: {
    venues: Array<{ id: string; label: string; address: string; primary: boolean }>;
    contacts: Array<{ name: string; email: string; phone: string; primary: boolean }>;
    reasons: string[];
    team: string[];
    me: string;
  } | null;
  /** last message body — quoted into Forward */
  lastBody: string;
  forwardFrom: string;
  /* ---- #96 §2 link sidebar ----
   * `resolution` is the sidebar's state machine, derived server-side: a
   * thread with a customer (stored, or resolved through a known contact
   * address) is "linked" whatever the sync stamped; a dismissed suggestion
   * is "unknown" (the sidebar must never re-offer it); a stale "suggested"/
   * "ambiguous" whose customers no longer exist collapses to "unknown". */
  resolution: "linked" | "suggested" | "ambiguous" | "unknown";
  /** sender's email domain — "" when the thread has no email */
  senderDomain: string;
  /** true when the domain can't identify a customer (public webmail / none) —
   *  the sidebar never offers "Link domain" for these */
  senderIsPublicDomain: boolean;
  /** linked only: the sender's domain is currently claimed by the linked
   *  customer, so future mail from it auto-links (and can be released) */
  domainClaimedByThisCustomer: boolean;
  /** present only when resolution === "suggested" */
  suggested: { customerId: string; name: string; contactsAtDomain: number } | null;
  /** present only when resolution === "ambiguous" */
  candidates: Array<{ customerId: string; name: string }>;
  /** present only when resolution === "linked" */
  customerCard: {
    id: string;
    name: string;
    tier: string;
    openQuotes: number;
    openProjects: number;
    /** the customer's contact whose email matches the sender, "" if none */
    contactName: string;
  } | null;
  /** every customer, for the pickers */
  customerOptions: Opt[];
  /** #122 — the same companies split into "Customers" / "Vendors" optgroups
   *  (vendor = type "vendor/manufacturer"); empty groups are omitted. */
  customerOptionGroups: Array<{ label: string; options: Opt[] }>;
  /** contacts of the linked/suggested customer (value = contact name — the
   *  doc-shape contact carries no id) */
  contactOptions: Opt[];
};

export type CustomerVM = {
  id: string;
  name: string;
  contacts: Array<{ name: string; role: string; email: string }>;
  primaryName: string;
  primaryEmail: string;
};

export type ComposeInit = {
  id: string | null;
  mailbox: string;
  to: string;
  cc: string;
  showCc: boolean;
  subject: string;
  body: string;
  customerId: string;
  contactName: string;
  /** Files already on the draft (IDEAS #36) — shown as chips; the bytes stay
   *  server-side on the draft record and ride through sendDraft(). */
  attachments?: AttachmentMetaVM[];
};

/** A category preset (client-safe copy of CATEGORIES for the pickers). */
export type CategoryOpt = { key: string; label: string; color: string };

/** A Gmail label available to filter by (client-safe copy of the mailbox's
 *  cached labels — see gmail/connections.ts listCachedLabels). */
export type LabelOpt = {
  id: string;
  name: string;
  type: "system" | "user";
  textColor: string | null;
  backgroundColor: string | null;
};

export type ListVM = {
  title: string;
  sub: string;
  rows: ThreadRowVM[];
  /** 'drafts' | 'outbox' | 'needs' | 'deleted' | '' — drives empty-state copy */
  emptyKind: string;
  /** narrow-screen mailbox switcher */
  boxSelValue: string;
  /** active command-bar filter key ('' = none) */
  filter: string;
  /** active Gmail label id filter ('' = none) */
  label: string;
  /** labels available to filter by for the current mailbox (possibly empty) */
  labelOptions: LabelOpt[];
  /** active *explicit* sort key ('' = none chosen — the resulting order then
   *  falls back to whichever mode's default applies, see comms.ts threadsIn
   *  and sort-defaults.ts; punch #42 finding 1) */
  sort: string;
  /** true in the Deleted folder — bulk actions offer Restore, not Delete */
  isDeleted: boolean;
};

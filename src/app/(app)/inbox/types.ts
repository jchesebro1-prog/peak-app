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

/** A mailbox label (sales@/installs@/info@) — these are Gmail groups that
 *  land tagged messages in the personal mailbox, not separate logins, so
 *  they render as flat label filters rather than full mailboxes. */
export type SharedBoxVM = {
  id: string;
  label: string;
  color: string;
  active: boolean;
  unread: number;
  href: string;
};

export type SidebarVM = {
  personal: {
    label: string; // "Jeff (me)"
    address: string;
    color: string;
    initials: string;
  };
  personalFolders: FolderRowVM[];
  sharedBoxes: SharedBoxVM[];
  views: FolderRowVM[];
  leadFollowCount: number;
  forwardAddr: string;
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
  /** active *explicit* sort key ('' = none chosen — the resulting order then
   *  falls back to whichever mode's default applies, see comms.ts threadsIn
   *  and sort-defaults.ts; punch #42 finding 1) */
  sort: string;
  /** true in the Deleted folder — bulk actions offer Restore, not Delete */
  isDeleted: boolean;
};

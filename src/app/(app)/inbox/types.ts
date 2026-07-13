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

export type SharedBoxVM = {
  id: string;
  label: string;
  address: string;
  color: string;
  active: boolean;
  unread: number;
  href: string;
  folders: FolderRowVM[]; // populated when expanded (active)
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
  name: string;
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

export type ListVM = {
  title: string;
  sub: string;
  rows: ThreadRowVM[];
  /** 'drafts' | 'outbox' | 'needs' | '' — drives the empty state copy */
  emptyKind: string;
  /** narrow-screen mailbox switcher */
  boxSelValue: string;
};

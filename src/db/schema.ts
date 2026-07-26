import { pgTable, text, boolean, bigint, jsonb, index } from "drizzle-orm/pg-core";

export * from "./doc-tables";

/**
 * Team roster — ported from the prototype's team.js (window.Users).
 * Field names and id format ('u1', 'u2', …) are preserved; the prototype's
 * localStorage key was `rss_users_v1`.
 *
 * Rebuild additions (documented in DECISIONS.md):
 * - googleEmail: alternate email used to match a Google SSO sign-in when it
 *   differs from the canonical company address (e.g. a personal Gmail).
 * - photoUrl: Google profile photo; UI still renders initials+color avatars
 *   as in the prototype, photo is kept for future use.
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  googleEmail: text("google_email"),
  roles: jsonb("roles").$type<string[]>().notNull(),
  color: text("color").notNull(),
  initials: text("initials").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  photoUrl: text("photo_url"),
});

/**
 * App settings — ported from settings.js (window.AppSettings, key
 * `rss_settings_v1`). Single-row JSON document, same shape as the prototype
 * blob; screens subscribe to changes (the prototype's `rss-settings` event).
 * Full Settings screen lands in a later phase; Phase 1 seeds the defaults.
 */
export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

/**
 * Gmail mailbox connections (Phase 7). One row per connected mailbox — a
 * person's own inbox (`personal:<userId>`) or a shared box (`sales`/`installs`/
 * `info`). Holds the OAuth tokens (encrypted at rest, see lib/gmail/crypto.ts)
 * and the Gmail sync cursor. Empty until someone connects a mailbox from
 * Settings; the whole feature is env-gated (lib/gmail/config.ts).
 */
export const gmailConnections = pgTable("gmail_connections", {
  mailboxKey: text("mailbox_key").primaryKey(), // "personal:u1" | "sales" | "installs" | "info"
  address: text("address").notNull(), // the Gmail address that authorized
  userId: text("user_id"), // set for personal mailboxes
  connectedBy: text("connected_by").notNull(), // display name of the connector
  refreshToken: text("refresh_token").notNull(), // encrypted
  accessToken: text("access_token"), // encrypted, cached until expiry
  expiresAt: bigint("expires_at", { mode: "number" }), // access-token expiry (epoch-ms)
  scope: text("scope"),
  historyId: text("history_id"), // Gmail incremental-sync cursor
  initialImportDone: boolean("initial_import_done").notNull().default(false),
  lastSyncAt: bigint("last_sync_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export type GmailConnectionRow = typeof gmailConnections.$inferSelect;
export type NewGmailConnectionRow = typeof gmailConnections.$inferInsert;

/* ------------------------------------------------------------------ *
 * Identity core (Daylite parity Phase 1, D85).
 * Design: docs/superpowers/specs/2026-07-19-daylite-parity-design.md §4.
 * Relational on purpose (§3.2): referential integrity for the 17-year
 * migration + indexed relationship queries. Server-authoritative — NOT
 * part of doc-store sync (field staff don't create contacts offline).
 * Company ids reuse the customer-directory slugs ('lakefront', …) so
 * every doc-store customerId keeps resolving unchanged.
 *
 * No DB-level FKs yet: the referenced ids ('u1', slugs) also live inside
 * jsonb docs where no constraint can reach; the converter's reconciliation
 * report is the integrity gate this phase (deviation recorded in D85).
 * ------------------------------------------------------------------ */

export const companies = pgTable(
  "companies",
  {
    id: text("id").primaryKey(), // customer slug convention ('lakefront')
    name: text("name").notNull(),
    /** Default hint only; per-deal truth arrives with Phase 2 junction roles.
     *  Carries the prototype's venue-segment values as-is for converted rows;
     *  value lists are configuration, not schema (§4.1). */
    type: text("type").notNull().default(""),
    /** Daylite's "category": prospect | customer | past | none (§4.1). */
    lifecycle: text("lifecycle").notNull().default("none"),
    keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
    website: text("website"),
    mainPhone: text("main_phone"),
    /** HQ/billing address — distinct from any venue address (§4.1). */
    address: text("address"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    /** Fallback only — the authoritative tier lives on the contact (§4.7). */
    pricingTier: text("pricing_tier"),
    /** Stored, not derived (§4.1) — fixes "owner = newest quote" failing for
     *  companies with no quotes. */
    ownerUserId: text("owner_user_id"),
    referredByContactId: text("referred_by_contact_id"),
    /** #23 custom-field VALUES, keyed by CustomFieldDef.id (definitions live
     *  in AppSettingsData.customerFieldDefs). Whole-map replacement when a
     *  writer provides it; string | number (epoch-ms for dates) | boolean |
     *  null per value. */
    custom: jsonb("custom")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    deleted: boolean("deleted").notNull().default(false),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("companies_deleted_idx").on(t.deleted)]
);

export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(), // 'ct-' + base36
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull().default(""),
    /** Nullable on purpose — changes when someone moves employers; Phase 2
     *  junction rows keep the historical hat (§4.2). */
    homeCompanyId: text("home_company_id"),
    /** Real job title — replaces the roles[0] hack (§4.2). */
    title: text("title").notNull().default(""),
    /** THE authoritative pricing tier (§4.7). Unused until item 11 lands. */
    pricingTier: text("pricing_tier"),
    /** active | former | do_not_contact — replaces the "gone" note (§4.2). */
    status: text("status").notNull().default("active"),
    /** Nullable link to a staff login (§4.2) — staff can also be customers. */
    userId: text("user_id"),
    ownerUserId: text("owner_user_id"),
    /** Transitional (D85): preserves the directory's "primary contact of the
     *  company" semantics until quotes designate their own primary (§4.7). */
    isPrimary: boolean("is_primary").notNull().default(false),
    deleted: boolean("deleted").notNull().default(false),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("contacts_home_company_idx").on(t.homeCompanyId),
    index("contacts_deleted_idx").on(t.deleted),
  ]
);

/** A contact has MANY labeled emails/phones (§4.3) — load-bearing for the
 *  portal (grants attach to a contact email), not cosmetic. */
export const contactEmails = pgTable(
  "contact_emails",
  {
    id: text("id").primaryKey(), // 'ce-' + suffix (deterministic in convert)
    contactId: text("contact_id").notNull(),
    email: text("email").notNull(),
    label: text("label").notNull().default("work"),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [
    index("contact_emails_contact_idx").on(t.contactId),
    index("contact_emails_email_idx").on(t.email),
  ]
);

export const contactPhones = pgTable(
  "contact_phones",
  {
    id: text("id").primaryKey(), // 'cp-' + suffix (deterministic in convert)
    contactId: text("contact_id").notNull(),
    phone: text("phone").notNull(),
    label: text("label").notNull().default("work"),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [index("contact_phones_contact_idx").on(t.contactId)]
);

export const sites = pgTable(
  "sites",
  {
    id: text("id").primaryKey(), // 'st-<companyId>-<n>' (deterministic in convert)
    companyId: text("company_id").notNull(), // the owning organization (§4.4)
    name: text("name").notNull().default(""),
    /** The per-customer location id docs already store ('loc1', …). Composed
     *  CustomerLocation.id returns this when present so stored locationId
     *  values and `${customerId}|${locationId}` keys keep matching (D85). */
    legacyLocId: text("legacy_loc_id"),
    isPrimary: boolean("is_primary").notNull().default(false),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    /** lat/lng/travel* are text: the doc shape allows number|string|null and
     *  "port faithfully" wins — the store seam converts on compose (D85). */
    lat: text("lat"),
    lng: text("lng"),
    venueKind: text("venue_kind").notNull().default("proscenium"),
    travelMiles: text("travel_miles"),
    travelMin: text("travel_min"),
    /** Placeholder for the later Drive integration (§4.4) — free now. */
    driveFolderId: text("drive_folder_id"),
    deleted: boolean("deleted").notNull().default(false),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("sites_company_idx").on(t.companyId),
    index("sites_deleted_idx").on(t.deleted),
  ]
);

export type CompanyRow = typeof companies.$inferSelect;
export type NewCompanyRow = typeof companies.$inferInsert;
export type ContactRow = typeof contacts.$inferSelect;
export type NewContactRow = typeof contacts.$inferInsert;
export type ContactEmailRow = typeof contactEmails.$inferSelect;
export type ContactPhoneRow = typeof contactPhones.$inferSelect;
export type SiteRow = typeof sites.$inferSelect;
export type NewSiteRow = typeof sites.$inferInsert;

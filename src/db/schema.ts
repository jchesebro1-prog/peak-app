import { pgTable, text, boolean, bigint, jsonb } from "drizzle-orm/pg-core";

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

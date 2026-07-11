import { defineConfig } from "drizzle-kit";

/**
 * With DATABASE_URL set (production/Neon): drizzle-kit talks to that Postgres.
 * Without it (local dev): drizzle-kit drives the embedded PGlite files in
 * .data/pglite — same database the dev server uses.
 */
export default defineConfig(
  process.env.DATABASE_URL
    ? {
        dialect: "postgresql",
        schema: "./src/db/schema.ts",
        out: "./drizzle",
        dbCredentials: { url: process.env.DATABASE_URL },
      }
    : {
        dialect: "postgresql",
        driver: "pglite",
        schema: "./src/db/schema.ts",
        out: "./drizzle",
        dbCredentials: { url: "./.data/pglite" },
      }
);

import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe auth config — used by middleware (no database imports here).
 * Full provider + database wiring lives in src/auth.ts.
 */
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
  providers: [],
} satisfies NextAuthConfig;

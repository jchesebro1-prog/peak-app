import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import { authConfig } from "./auth.config";
import { getUser, getUserByEmail, updateUser } from "@/lib/users";

/**
 * Sign-in model (DECISIONS.md):
 * - Google SSO is the production sign-in. Access is invite-list based: the
 *   Google account's email must match an ACTIVE row in the users table
 *   (email or googleEmail) — Settings → Team is the invite list.
 * - Dev sign-in (pick a team member, no password) is available only when
 *   AUTH_DEV_LOGIN=true, or in local dev when Google isn't configured yet.
 *   Never enable AUTH_DEV_LOGIN in production.
 */

export function googleConfigured(): boolean {
  return !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

export function devLoginEnabled(): boolean {
  if (process.env.AUTH_DEV_LOGIN === "true") return true;
  return process.env.NODE_ENV !== "production" && !googleConfigured();
}

const providers: Provider[] = [];

if (googleConfigured()) providers.push(Google);

if (devLoginEnabled()) {
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Dev sign-in",
      credentials: { userId: { label: "User id" } },
      async authorize(creds) {
        const u = await getUser(String(creds?.userId ?? ""));
        if (!u || !u.active) return null;
        return { id: u.id, name: u.name, email: u.email };
      },
    })
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers,
  callbacks: {
    ...authConfig.callbacks,
    // Keep the user on whatever host they signed in from — localhost, the
    // Mac's LAN IP, or its <name>.local address — so a dev/LAN session never
    // gets bounced to a different origin (where its cookie wouldn't apply).
    // Only local/private hosts are honored; anything else falls back to the
    // app root, so this can't be used as an open redirect.
    async redirect({ url, baseUrl }) {
      try {
        const u = new URL(url, baseUrl);
        const h = u.hostname;
        const isLocal =
          h === "localhost" ||
          h === "127.0.0.1" ||
          h.endsWith(".local") ||
          /^10\./.test(h) ||
          /^192\.168\./.test(h) ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(h);
        if (isLocal) return u.origin + u.pathname + u.search;
      } catch {
        /* fall through */
      }
      if (url.startsWith("/")) return url;
      return baseUrl;
    },
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        const row = await getUserByEmail(user.email || "");
        if (!row || !row.active) return false;
        if (user.image && user.image !== row.photoUrl) {
          await updateUser(row.id, { photoUrl: user.image });
        }
        return true;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const row = await getUserByEmail(user.email);
        if (row) {
          token.uid = row.id;
          token.name = row.name;
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Roles are re-read per request so role edits / deactivation apply
      // without waiting for the JWT to expire.
      const row = token.uid
        ? await getUser(String(token.uid))
        : await getUserByEmail(session.user?.email || "");
      if (row) {
        session.user.id = row.id;
        session.user.name = row.name;
        session.user.email = row.email;
        session.user.roles = row.roles;
        session.user.initials = row.initials;
        session.user.color = row.color;
        session.user.active = row.active;
      } else if (session.user) {
        session.user.active = false;
      }
      return session;
    },
  },
});

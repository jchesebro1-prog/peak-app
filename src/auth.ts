import NextAuth from "next-auth";
import { timingSafeEqual } from "node:crypto";
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
 * - Local preview sign-in accepts an active team email plus an access code.
 *   It is available only outside production and requires AUTH_DEV_ACCESS_CODE.
 */

export function googleConfigured(): boolean {
  return !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

export function devLoginEnabled(): boolean {
  // Preview deployments use production builds, so VERCEL_ENV distinguishes a
  // disposable preview from the live app. The access-code provider below is
  // always off for production, even if preview environment variables leak.
  const isProductionDeployment =
    process.env.NODE_ENV === "production" && process.env.VERCEL_ENV !== "preview";
  if (isProductionDeployment) return false;
  if (process.env.AUTH_DEV_LOGIN === "true") return true;
  return process.env.NODE_ENV !== "production" && !googleConfigured();
}

export function previewLoginEnabled(): boolean {
  return devLoginEnabled() && !!process.env.AUTH_DEV_ACCESS_CODE;
}

function validPreviewCode(code: string): boolean {
  const expected = process.env.AUTH_DEV_ACCESS_CODE;
  if (!expected) return false;
  const supplied = Buffer.from(code);
  const configured = Buffer.from(expected);
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}

const providers: Provider[] = [];

if (googleConfigured()) providers.push(Google);

if (previewLoginEnabled()) {
  providers.push(
    Credentials({
      id: "preview-login",
      name: "Preview sign-in",
      credentials: {
        email: { label: "Email", type: "email" },
        accessCode: { label: "Access code", type: "password" },
      },
      async authorize(creds) {
        if (!validPreviewCode(String(creds?.accessCode ?? ""))) return null;
        const u = await getUserByEmail(String(creds?.email ?? ""));
        if (!u || u.status !== "active") return null;
        return { id: u.id, name: u.name, email: u.email };
      },
    }),
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
        if (!row || row.status !== "active") return false;
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
        session.user.active = row.status === "active";
      } else if (session.user) {
        session.user.active = false;
      }
      return session;
    },
  },
});

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { can, type Perm } from "./team";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  roles: string[];
  initials: string;
  color: string;
  active: boolean;
};

/** The signed-in active team member, or null — never redirects. Use where a
 *  team session is optional (e.g. team-gated portal preview). */
export async function getOptionalUser(): Promise<SessionUser | null> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.active) return null;
  return {
    id: u.id,
    name: u.name || "",
    email: u.email || "",
    roles: u.roles || [],
    initials: u.initials || "",
    color: u.color || "#6b7079",
    active: u.active,
  };
}

/** The signed-in, active team member — redirects to /login otherwise. */
export async function requireUser(): Promise<SessionUser> {
  const u = await getOptionalUser();
  if (!u) redirect("/login");
  return u;
}

/** Same, but also requires a permission (e.g. "manage_users" for Settings → Team). */
export async function requirePerm(perm: Perm): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(perm, user.roles)) redirect("/");
  return user;
}

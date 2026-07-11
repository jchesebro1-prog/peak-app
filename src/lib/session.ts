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

/** The signed-in, active team member — redirects to /login otherwise. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.active) redirect("/login");
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

/** Same, but also requires a permission (e.g. "manage_users" for Settings → Team). */
export async function requirePerm(perm: Perm): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(perm, user.roles)) redirect("/");
  return user;
}

"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { can } from "@/lib/team";
import { normalizeSlug, slugProblem } from "@/lib/booth/shows";
import { listCards, setCard, writeShow } from "@/lib/stores/booth";
import { allUsers } from "@/lib/users";

type Result = { ok: boolean; error?: string };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function saveShowAction(input: { id?: string; name: string; startAt: number | null; endAt: number | null }): Promise<Result> {
  await requirePerm("create");
  const r = await writeShow({
    kind: "upsert",
    show: { id: typeof input?.id === "string" ? input.id : undefined, name: input?.name, startAt: num(input?.startAt), endAt: num(input?.endAt) },
  });
  revalidatePath("/leads/shows");
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function showOpAction(op: { kind: "activate" | "archive" | "unarchive"; id: string } | { kind: "deactivate" }): Promise<Result> {
  await requirePerm("create");
  let clean: Parameters<typeof writeShow>[0];
  if (op?.kind === "deactivate") clean = { kind: "deactivate" };
  else if ((op?.kind === "activate" || op?.kind === "archive" || op?.kind === "unarchive") && typeof op.id === "string") clean = { kind: op.kind, id: op.id };
  else return { ok: false, error: "That isn't a show action." };
  const r = await writeShow(clean);
  revalidatePath("/leads/shows");
  revalidatePath("/leads/booth");
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Admin-only. userId null removes the link. A link name another person holds is refused, never taken over. */
export async function setCardAction(slug: string, userId: string | null): Promise<Result> {
  const me = await requirePerm("create");
  if (!can("manage_users", me.roles)) return { ok: false, error: "Only an admin can change contact cards." };
  const s = normalizeSlug(slug);
  const problem = slugProblem(s);
  if (problem) return { ok: false, error: problem };
  if (userId) {
    const users = await allUsers();
    const person = users.find((u) => u.id === userId);
    if (!person || person.status !== "active") return { ok: false, error: "Pick an active team member." };
    const holder = (await listCards())[s];
    if (holder && holder !== userId) {
      const other = users.find((u) => u.id === holder);
      return { ok: false, error: `That link name is already used by ${other?.name ?? "someone else"}.` };
    }
  }
  const r = await setCard(s, userId);
  revalidatePath("/leads/shows");
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

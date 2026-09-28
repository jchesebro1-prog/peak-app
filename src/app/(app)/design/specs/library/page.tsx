import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import SectionsView from "./sections-view";
import RecordsView from "./records-view";

/**
 * The Spec Library (spec records design §7): the records view is the
 * default; the sections / Part 2 articles / coverage / import-export content
 * that used to be this whole page lives one click away under
 * `?view=sections`, unchanged (`sections-view.tsx`).
 */

export const metadata = { title: "Spec library — Quartzite-6" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function SpecLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const view = one(sp.view);
  if (view === "sections") return <SectionsView sp={sp} />;
  return <RecordsView sp={sp} canCreate={can("create", user.roles)} />;
}

import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import AssemblyBuilder from "./assembly-builder";

export const metadata = { title: "Assembly Builder — Quartzite-6" };

export default async function AssemblyBuilderPage() {
  await requireUser();
  const settings = await getSettings();
  return <AssemblyBuilder initial={settings.fixtureAssemblies || []} />;
}

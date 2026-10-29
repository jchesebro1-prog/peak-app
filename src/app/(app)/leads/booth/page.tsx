import { requirePerm } from "@/lib/session";
import { getActiveShow, listCapturesForShow, listShows } from "@/lib/stores/booth";
import BoothForm from "./booth-form";

export const dynamic = "force-dynamic";

export default async function BoothPage() {
  const me = await requirePerm("create");
  const [shows, active] = await Promise.all([listShows(), getActiveShow()]);
  const recent = active ? (await listCapturesForShow(active.id)).slice(0, 50) : [];
  return (
    <BoothForm
      shows={shows.filter((s) => !s.archived).map((s) => ({ id: s.id, name: s.name }))}
      activeShowId={active?.id ?? null}
      me={{ id: me.id, name: me.name }}
      recent={recent.map((c) => ({
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        company: c.company,
        temperature: c.temperature,
        capturedAt: c.capturedAt,
        leadId: c.leadId,
        outcome: c.outcome,
        showId: c.showId,
      }))}
    />
  );
}

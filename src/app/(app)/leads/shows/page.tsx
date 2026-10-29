import QRCode from "qrcode";
import { headers } from "next/headers";
import { requirePerm } from "@/lib/session";
import { can } from "@/lib/team";
import { allUsers } from "@/lib/users";
import { originFrom } from "@/lib/quote-pdf/origin";
import { listCards, listShows } from "@/lib/stores/booth";
import ShowsEditor from "./shows-editor";

export const dynamic = "force-dynamic";

export default async function ShowsPage() {
  const me = await requirePerm("create");
  const [shows, cards, users, h] = await Promise.all([listShows(), listCards(), allUsers(), headers()]);
  // The app's own origin: QUOTE_PDF_ORIGIN pins it, else this request's host.
  const origin = originFrom(h.get("host"), h.get("x-forwarded-proto"), process.env.QUOTE_PDF_ORIGIN) ?? "";
  const cardRows = await Promise.all(
    Object.entries(cards)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(async ([slug, userId]) => {
        const url = `${origin}/c/${slug}`;
        return { slug, userId, url, qrSvg: await QRCode.toString(url, { type: "svg", margin: 4, width: 1024, errorCorrectionLevel: "M" }) };
      })
  );
  return (
    <ShowsEditor
      shows={shows}
      cards={cardRows}
      users={users.filter((u) => u.status === "active").map((u) => ({ id: u.id, name: u.name }))}
      isAdmin={can("manage_users", me.roles)}
    />
  );
}

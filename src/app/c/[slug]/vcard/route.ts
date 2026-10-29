import { cardUserId } from "@/lib/stores/booth";
import { getUser } from "@/lib/users";
import { getSettings } from "@/lib/settings";
import { buildVCard, contentDispositionFor } from "@/lib/booth/vcard";
import { guardedFetchBytes } from "@/lib/venue-calendar-fetch";

export const dynamic = "force-dynamic";

/** Public: the card owner's vCard (Save contact). Photo fetched server-side through the shared SSRF guard, ≤ 200 KB JPEG, omitted on any failure. */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const userId = await cardUserId(slug);
  const user = userId ? await getUser(userId) : null;
  if (!user || user.status !== "active") return new Response("Not found", { status: 404 });
  const settings = await getSettings();
  let photo: string | undefined;
  if (user.photoUrl) {
    try {
      const got = await guardedFetchBytes(user.photoUrl, {
        maxBytes: 200_000,
        timeoutMs: 4000,
        maxRedirects: 3,
        accept: "image/jpeg",
        userAgent: "peak-app/1.0 (Peak Systems Group contact card)",
      });
      const b = got.ok ? got.bytes : null;
      // Magic bytes, not the header: a vCard PHOTO;TYPE=JPEG must really be a JPEG.
      if (b && b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) photo = Buffer.from(b).toString("base64");
    } catch {
      photo = undefined;
    }
  }
  // AppSettingsData has no website field, so the card carries no URL line.
  const vcf = buildVCard({
    name: user.name,
    org: settings.companyName || "Peak Systems Group",
    title: user.title || "",
    workPhone: user.phone || "",
    cellPhone: user.mobile || "",
    email: user.email,
    photoJpegBase64: photo,
  });
  return new Response(vcf, {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": contentDispositionFor(user.name),
      "Cache-Control": "no-store",
    },
  });
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cardUserId } from "@/lib/stores/booth";
import { getUser } from "@/lib/users";
import { getSettings } from "@/lib/settings";
import ShareBackForm from "./share-back-form";

/**
 * Public contact card — what Jeff's NFC card (and its QR) opens. No auth, no
 * nav (middleware exempts /c/). Save contact downloads a vCard; Send me your
 * info becomes a lead + a follow-up draft (api/booth/share-back).
 */

export const dynamic = "force-dynamic";

async function load(slug: string) {
  const id = await cardUserId(slug);
  const user = id ? await getUser(id) : null;
  return user && user.status === "active" ? user : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const user = await load((await params).slug);
  const s = await getSettings();
  return { title: user ? `${user.name} — ${s.companyName || "Peak Systems Group"}` : "Contact card", robots: { index: false } };
}

export default async function ContactCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await load(slug);
  if (!user) notFound();
  const s = await getSettings();
  const company = s.companyName || "Peak Systems Group";
  return (
    <main style={{ minHeight: "100vh", background: "#edeef1", fontFamily: "var(--font-ui)", color: "#16181d", padding: "24px 16px" }}>
      <div style={{ maxWidth: 440, margin: "0 auto", display: "grid", gap: 16 }}>
        <section className="pk-card" style={{ padding: 20, textAlign: "center", display: "grid", gap: 8 }}>
          {user.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.photoUrl} alt="" width={96} height={96} style={{ borderRadius: "50%", margin: "0 auto", objectFit: "cover" }} />
          ) : (
            <div aria-hidden style={{ width: 96, height: 96, borderRadius: "50%", margin: "0 auto", background: user.color, color: "#fff", display: "grid", placeItems: "center", fontSize: 32, fontWeight: 700 }}>{user.initials}</div>
          )}
          <h1 style={{ fontSize: 22, margin: 0 }}>{user.name}</h1>
          {user.title ? <div style={{ color: "#5b616e" }}>{user.title}</div> : null}
          <div style={{ fontWeight: 600 }}>{company}</div>
          <div style={{ display: "grid", gap: 4, marginTop: 6, fontSize: 14 }}>
            {user.mobile ? <a href={`tel:${user.mobile}`}>{user.mobile} (mobile)</a> : null}
            {user.phone ? <a href={`tel:${user.phone}`}>{user.phone} (office)</a> : null}
            <a href={`mailto:${user.email}`}>{user.email}</a>
          </div>
          <a className="pk-btn-accent" href={`/c/${encodeURIComponent(slug)}/vcard`} style={{ marginTop: 10, display: "block", textDecoration: "none", padding: "12px 14px", fontSize: 14 }}>Save contact</a>
        </section>
        <ShareBackForm slug={slug} firstName={user.name.split(" ")[0]} />
      </div>
    </main>
  );
}

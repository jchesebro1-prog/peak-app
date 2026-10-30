/**
 * The contact card's fields (#372, D1331). Pure. One builder feeds the public
 * card page, Save contact (vCard) and the share-back draft's vCard, so the
 * three can't drift. The website is normalized here (Settings → Branding);
 * the address is the person's office (else the main office) via baseOffice.
 */
import { baseOffice, type OriginOffice } from "@/lib/travel-origin";
import type { CardAddress, VCardInput } from "./vcard";

export type { CardAddress } from "./vcard";

/** "" = clear; a normalized http(s) URL; or null when it isn't a web address. */
export function normalizeWebsite(raw: string): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  // "host:8080" is a host with a port, not a scheme.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[^/:]*:\d+(\/|$)/.test(t);
  let url: URL;
  try {
    url = new URL(hasScheme ? t : `https://${t.replace(/^\/\//, "")}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".")) return null;
  if (url.username || url.password) return null;
  let out = url.toString();
  if (url.pathname === "/" && !url.search && !url.hash) out = out.replace(/\/$/, "");
  return out.length > 200 ? null : out;
}

/** Display text for a website link: no scheme, no leading www., no trailing slash. */
export function websiteLabel(url: string): string {
  return String(url || "").trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}

/** [street, "City, ST 12345"] with blanks dropped cleanly. */
export function cardAddressLines(a: CardAddress): string[] {
  const street = (a.street || "").trim();
  const city = (a.city || "").trim();
  const stateZip = [(a.state || "").trim(), (a.zip || "").trim()].filter(Boolean).join(" ");
  const second = city && stateZip ? `${city}, ${stateZip}` : city || stateZip;
  return [street, second].filter(Boolean);
}

export type CardOffice = OriginOffice & CardAddress;

export function contactCardFields(
  user: { name: string; title?: string | null; phone?: string | null; mobile?: string | null; email?: string | null; officeId?: string | null },
  settings: { companyName?: string; website?: string; offices?: CardOffice[] }
): Omit<VCardInput, "photoJpegBase64"> {
  const offices = settings.offices ?? [];
  const base = baseOffice(offices, user.officeId);
  const office = base ? offices.find((o) => o.id === base.id) : undefined;
  const address: CardAddress | undefined =
    office && ((office.street || "").trim() || (office.city || "").trim())
      ? { street: office.street || "", city: office.city || "", state: office.state || "", zip: office.zip || "" }
      : undefined;
  const site = (settings.website || "").trim();
  return {
    name: user.name,
    org: settings.companyName || "Peak Systems Group",
    title: user.title || "",
    workPhone: user.phone || "",
    cellPhone: user.mobile || "",
    email: user.email || "",
    ...(site ? { url: site } : {}),
    ...(address ? { address } : {}),
  };
}

import { cleanWireTypes, resolveWireTypes, type WireType } from "@/lib/catalog-connect";

/**
 * Starter cables (Grid notes #5). ~20 cables Peak pulls on a typical
 * theatrical lighting / AV / rigging install, each with its real manufacturer
 * part number and its datasheet's nominal outside diameter, seeded into the
 * Catalog as $0 drafts (cost 0, list 0 — Jeff prices them per ft in the
 * Catalog) and linked to the wire type that carries it.
 *
 * Every OD here was read from the manufacturer's own datasheet (URL per
 * row). The Belden/TMB rows the #328 research already resolved
 * (docs/specs-seed/cable-od-2026-10-10.json) are reused as-is. A cable whose
 * OD could not be confirmed would carry no `cableOdIn` — never a guess.
 *
 * SKUs follow the #304 model-number convention, `Brand:Model`; the order
 * number lives in the MFR P/N.
 *
 * Pure: no store/db imports. The loader is wire-starter-server.ts.
 */

export type WireStarterCable = {
  /** `Brand:Model` (#304). */
  sku: string;
  manufacturer: string;
  modelNumber: string;
  /** The manufacturer's order / stock number. */
  mfrPartNumber: string;
  desc: string;
  category: "Wire";
  unit: "ft";
  cost: 0;
  list: 0;
  /** Nominal outside diameter, inches, from the datasheet. */
  cableOdIn?: number;
  /** An id in DEFAULT_WIRE_TYPES. */
  wireTypeId: string;
  /** The datasheet the part number and OD were read from. */
  source: string;
};

const c = (
  sku: string,
  mfrPartNumber: string,
  desc: string,
  cableOdIn: number | undefined,
  wireTypeId: string,
  source: string
): WireStarterCable => {
  const i = sku.indexOf(":");
  return {
    sku,
    manufacturer: sku.slice(0, i),
    modelNumber: sku.slice(i + 1),
    mfrPartNumber,
    desc,
    category: "Wire",
    unit: "ft",
    cost: 0,
    list: 0,
    ...(cableOdIn !== undefined ? { cableOdIn } : {}),
    wireTypeId,
    source,
  };
};

export const WIRE_STARTER: readonly WireStarterCable[] = [
  // ---- DMX / RS-485 lighting data ----
  // https://catalog.belden.com/techdata/EN/9729_techdata.pdf
  c("Belden:9729", "9729", "DMX cable, 2 pair 24 AWG, individually foil-shielded, PVC, CM", 0.266, "dmx-5pin", "https://catalog.belden.com/techdata/EN/9729_techdata.pdf"),
  // https://catalog.belden.com/techdata/EN/9841_techdata.pdf
  c("Belden:9841", "9841", "RS-485 / DMX cable, 1 pair 24 AWG, foil + braid shield, PVC, CM", 0.232, "dmx-5pin", "https://catalog.belden.com/techdata/EN/9841_techdata.pdf"),
  // https://tmb.com/docs/proplex/dmx/pdf/ProPlex-PC244T-LTR-web.pdf
  c("TMB:PC244T", "PC244T", "ProPlex installation DMX cable for conduit, 2 pair 24 AWG, individually shielded, CM", 0.315, "dmx-5pin", "https://tmb.com/docs/proplex/dmx/pdf/ProPlex-PC244T-LTR-web.pdf"),

  // ---- Network (sACN / Art-Net / Dante / HDBaseT) ----
  // https://catalog.belden.com/techdata/EN/1583A_techdata.pdf
  c("Belden:1583A", "1583A", "Cat5e U/UTP, 4 pair 24 AWG solid, riser CMR", 0.19, "cat6", "https://catalog.belden.com/techdata/EN/1583A_techdata.pdf"),
  // https://catalog.belden.com/techdata/EN/2412_techdata.pdf
  c("Belden:2412", "2412", "Cat6+ U/UTP, 4 pair 23 AWG solid, riser CMR", 0.224, "cat6", "https://catalog.belden.com/techdata/EN/2412_techdata.pdf"),
  // https://catalog.belden.com/techdata/EN/2413_techdata.pdf
  c("Belden:2413", "2413", "Cat6+ U/UTP, 4 pair 23 AWG solid, plenum CMP", 0.224, "cat6", "https://catalog.belden.com/techdata/EN/2413_techdata.pdf"),
  // https://catalog.belden.com/techdata/EN/2412FS_techdata.pdf
  c("Belden:2412FS", "2412FS", "Cat6+ F/UTP shielded, 4 pair 23 AWG solid, riser CMR (etherCON / sACN runs)", 0.275, "cat6", "https://catalog.belden.com/techdata/EN/2412FS_techdata.pdf"),

  // ---- Audio ----
  // https://catalog.belden.com/techdata/EN/8451_techdata.pdf (jacket nominal diameter)
  c("Belden:8451", "8451", "Mic / line audio cable, 1 pair 22 AWG, overall foil shield, CM", 0.138, "xlr-audio", "https://catalog.belden.com/techdata/EN/8451_techdata.pdf"),
  // https://catalog.belden.com/techdata/EN/1800F_techdata.pdf
  c("Belden:1800F", "1800F", "Digital audio (AES/EBU) / mic cable, 1 pair 24 AWG, 95% braid, flexible, CL2R", 0.211, "xlr-audio", "https://catalog.belden.com/techdata/EN/1800F_techdata.pdf"),
  // https://catalog.belden.com/techdata/EN/5100UE_techdata.pdf
  c("Belden:5100UE", "5100UE", "Speaker cable 14/2, unshielded, riser CL3R", 0.218, "speaker-pair", "https://catalog.belden.com/techdata/EN/5100UE_techdata.pdf"),
  // https://catalog.belden.com/techdata/EN/5000UE_techdata.pdf
  c("Belden:5000UE", "5000UE", "Speaker cable 12/2, unshielded, riser CL3R", 0.26, "speaker-pair", "https://catalog.belden.com/techdata/EN/5000UE_techdata.pdf"),
  // https://catalog.belden.com/techdata/EN/5002UP_techdata.pdf
  c("Belden:5002UP", "5002UP", "Speaker cable 12/4, unshielded, flexible, CL3", 0.377, "speaker-pair", "https://catalog.belden.com/techdata/EN/5002UP_techdata.pdf"),
  // https://catalog.belden.com/techdata/EN/5200UE_techdata.pdf
  c("Belden:5200UE", "5200UE", "70V speaker cable 16/2, unshielded, riser CMR", 0.18, "speaker-pair", "https://catalog.belden.com/techdata/EN/5200UE_techdata.pdf"),

  // ---- Video / fiber ----
  // https://catalog.belden.com/techdata/EN/1694A_techdata.pdf
  c("Belden:1694A", "1694A", "SDI coax, RG-6, 75 ohm, 18 AWG solid, foil + 95% braid, CMR (12G/6G/HD-SDI)", 0.274, "sdi-coax", "https://catalog.belden.com/techdata/EN/1694A_techdata.pdf"),
  // https://ecatalog.corning.com/optical-communications/US/en/Fiber-Optic-Cables/Indoor-Outdoor/Indoor-Outdoor-Riser-Cables/FREEDM%C2%AE-One-Tight-Buffered-Cable%2C-Riser/p/006T8F-31180-29
  c("Corning:006T8F-31180-29", "006T8F-31180-29", "Fiber, 6-strand OM3 50 µm multimode, FREEDM One tight-buffered, indoor/outdoor riser OFNR", 0.22, "fiber", "https://ecatalog.corning.com/optical-communications/US/en/Fiber-Optic-Cables/Indoor-Outdoor/Indoor-Outdoor-Riser-Cables/FREEDM%C2%AE-One-Tight-Buffered-Cable%2C-Riser/p/006T8F-31180-29"),

  // ---- Low-voltage control ----
  // https://catalog.belden.com/techdata/EN/8760_techdata.pdf
  c("Belden:8760", "8760", "0-10V dimming control cable, 18/2 overall foil shield, CM", 0.222, "etc-0-10v", "https://catalog.belden.com/techdata/EN/8760_techdata.pdf"),
  // https://catalog.belden.com/techdata/EN/8471_techdata.pdf — ETC's specified EchoConnect data cable
  c("Belden:8471", "8471", "EchoConnect data cable, 16/2 unshielded, CMG (ETC-specified)", 0.274, "etc-echoconnect", "https://catalog.belden.com/techdata/EN/8471_techdata.pdf"),
  // https://catalog.belden.com/techdata/EN/8461_techdata.pdf
  c("Belden:8461", "8461", "Contact closure / control cable, 18/2 unshielded, CMG", 0.234, "contact-closure", "https://catalog.belden.com/techdata/EN/8461_techdata.pdf"),

  // ---- Power / rigging (Southwire Spec 70000, Royal SOOW, Table 1) ----
  // https://cabletechsupport.southwire.com/en/cablespec/download_spec/?spec=70000&country=US
  c("Southwire:558094", "558094", "Portable cord 12/3 SOOW, 600V, black (Royal)", 0.608, "powercon-power", "https://cabletechsupport.southwire.com/en/cablespec/download_spec/?spec=70000&country=US"),
  c("Southwire:558102", "558102", "Motor power cord 14/4 SOOW, 600V, black (Royal) — chain hoist feed", 0.57, "motor-power", "https://cabletechsupport.southwire.com/en/cablespec/download_spec/?spec=70000&country=US"),
];

/**
 * What a linked wire type gains, filled ONLY where it is blank: the cable the
 * riser data sheet / conduit riser name for it (one per wire type — the first
 * listed, the most common pull), the 1–3 character riser bubble and its
 * legend signal. DMX / network / EchoConnect / contact closure use Bray's
 * legend codes (conduit-riser/wire-symbols.ts, D814) so the two fills agree.
 */
export const WIRE_STARTER_LINKS: readonly { wireTypeId: string; cableSku: string; symbol: string; signal: string }[] = [
  { wireTypeId: "dmx-5pin", cableSku: "Belden:9729", symbol: "D", signal: "DMX" },
  { wireTypeId: "cat6", cableSku: "Belden:2412", symbol: "N", signal: "Network" },
  { wireTypeId: "xlr-audio", cableSku: "Belden:8451", symbol: "A", signal: "Audio" },
  { wireTypeId: "speaker-pair", cableSku: "Belden:5100UE", symbol: "SP", signal: "Speaker" },
  { wireTypeId: "sdi-coax", cableSku: "Belden:1694A", symbol: "V", signal: "Video (SDI)" },
  { wireTypeId: "fiber", cableSku: "Corning:006T8F-31180-29", symbol: "F", signal: "Fiber" },
  { wireTypeId: "etc-0-10v", cableSku: "Belden:8760", symbol: "LV", signal: "0-10V dimming" },
  { wireTypeId: "etc-echoconnect", cableSku: "Belden:8471", symbol: "UE", signal: "EchoConnect" },
  { wireTypeId: "contact-closure", cableSku: "Belden:8461", symbol: "CC", signal: "Contact closure" },
  { wireTypeId: "powercon-power", cableSku: "Southwire:558094", symbol: "PW", signal: "Power" },
  { wireTypeId: "motor-power", cableSku: "Southwire:558102", symbol: "M", signal: "Motor power" },
];

/**
 * The stored wire-type list after linking the starter cables: the defaults
 * are materialised first (resolveWireTypes), then each linked type gains its
 * cableSku / symbol / signal ONLY where that field is blank, and the result
 * goes through cleanWireTypes like every save. `skuFor` maps a starter SKU
 * to the catalog SKU that actually holds that cable (an existing part under
 * another SKU wins). A wire type the admin deleted is never re-added.
 * Returns the new list and how many wire types changed.
 */
export function linkStarterWireTypes(
  stored: WireType[] | undefined | null,
  skuFor: (starterSku: string) => string = (s) => s,
  links: readonly { wireTypeId: string; cableSku: string; symbol: string; signal: string }[] = WIRE_STARTER_LINKS
): { wireTypes: WireType[]; linked: number } {
  const byId = new Map(links.map((l) => [l.wireTypeId, l]));
  let linked = 0;
  const next = resolveWireTypes(stored ?? undefined).map((wt) => {
    const l = byId.get(wt.id);
    if (!l) return { ...wt };
    const out: WireType = { ...wt };
    if (!out.cableSku?.trim()) out.cableSku = skuFor(l.cableSku);
    if (!out.symbol?.trim()) out.symbol = l.symbol;
    if (!out.signal?.trim()) out.signal = l.signal;
    if (out.cableSku !== wt.cableSku || out.symbol !== wt.symbol || out.signal !== wt.signal) linked += 1;
    return out;
  });
  return { wireTypes: cleanWireTypes(next) ?? resolveWireTypes(undefined), linked };
}

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The catalog part that already IS this starter cable, or null: the same SKU
 * (live, or one a rename retired into it via formerSkus), else a part whose
 * manufacturer matches and whose Model # or MFR P/N equals the cable's model
 * — so a Belden 1583A someone imported as "BEL-1583A" is not duplicated.
 */
export function findExistingCable<P extends { sku: string; mfr?: string; manufacturerModelNumber?: string; manufacturerPartNumber?: string; formerSkus?: string[] }>(
  cable: Pick<WireStarterCable, "sku" | "manufacturer" | "modelNumber" | "mfrPartNumber">,
  parts: readonly P[]
): P | null {
  const sku = cable.sku.toLowerCase();
  const exact = parts.find((p) => p.sku.toLowerCase() === sku || (p.formerSkus ?? []).some((f) => f.toLowerCase() === sku));
  if (exact) return exact;
  const mfr = norm(cable.manufacturer);
  const models = new Set([norm(cable.modelNumber), norm(cable.mfrPartNumber)]);
  return (
    parts.find((p) => {
      const pm = norm(p.mfr);
      if (pm.length < 3 || !(pm === mfr || pm.startsWith(mfr) || mfr.startsWith(pm))) return false;
      return models.has(norm(p.manufacturerModelNumber)) || models.has(norm(p.manufacturerPartNumber));
    }) ?? null
  );
}

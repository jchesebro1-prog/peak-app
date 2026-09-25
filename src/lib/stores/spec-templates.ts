import { getDoc, listDocs, upsertDoc, softDeleteDoc, type Doc } from "@/db/doc-store";

/**
 * Authoring formulas (D-SPEC). A template is not spec text — it is the shape of
 * a spec entry for one kind of product: which headings to write, what to pull
 * from the cut sheet for each, and the phrasing rules. "Insert template" in
 * the part editor writes the headings as a scaffold into an empty body, and
 * `Export templates` writes this collection to the JSON file the spec-writer
 * skill reads. No template text ever prints in a document.
 */

export type SpecTemplateHeading = { label: string; guidance: string };

export type SpecTemplate = {
  /** Slug of `key` — also the /design/specs/templates/[key] segment. */
  id: string;
  /** Display key the author matches a part against, e.g. "Fixtures". */
  key: string;
  title: string;
  headings: SpecTemplateHeading[];
  /** Phrasing rules: "shall", basis-of-design clause, listings first… */
  rules: string;
  /** One worked entry in outline text. Empty on the starters. */
  example: string;
  updatedAt: number;
  updatedBy: string;
};

export function templateId(key: string): string {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Headings → an empty scaffold the author fills in. Flat on purpose: the
 *  author indents whatever belongs deeper. */
export function scaffoldFrom(t: SpecTemplate): string {
  return t.headings.map((h) => `${h.label}:`).join("\n");
}

function normalize(raw: unknown): SpecTemplate {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const headings = Array.isArray(o.headings)
    ? o.headings
        .map((h) => {
          const x = (h && typeof h === "object" ? h : {}) as Record<string, unknown>;
          return { label: String(x.label || "").trim(), guidance: String(x.guidance || "").trim() };
        })
        .filter((h) => h.label)
    : [];
  const key = String(o.key || "").trim();
  return {
    id: String(o.id || "") || templateId(key),
    key,
    title: String(o.title || "").trim(),
    headings,
    rules: typeof o.rules === "string" ? o.rules : "",
    example: typeof o.example === "string" ? o.example : "",
    updatedAt: Number(o.updatedAt) || 0,
    updatedBy: String(o.updatedBy || ""),
  };
}

export const STARTER_TEMPLATES: Array<Omit<SpecTemplate, "id" | "updatedAt" | "updatedBy">> = [
  {
    key: "Fixtures",
    title: "Lighting Fixture",
    headings: [
      { label: "Basis of Design", guidance: "Manufacturer and model exactly as the cut sheet names them." },
      { label: "Standards Compliance", guidance: "Listings and standards the sheet claims — UL/ETL, IP rating, photobiological safety." },
      { label: "Source", guidance: "Emitter type and count, rated life, lumen output and field angle range." },
      { label: "Color", guidance: "Colour system, CCT range, CRI/TM-30 figures, and the colour-mixing engine." },
      { label: "Control", guidance: "Protocols (DMX512-A, RDM, sACN, Art-Net), dimming curves, resolution, onboard UI." },
      { label: "Electrical", guidance: "Input voltage range, power draw at full, connector type, power-through limits." },
      { label: "Physical", guidance: "Weight, yoke and clamp arrangement, accessory slot size, finish." },
      { label: "Accessories", guidance: "Only what is being purchased with the fixture; everything else belongs on its own line." },
    ],
    rules: "Every clause is a requirement: use \"shall\". Name the basis of design first, then the standards it must meet, then performance. Never print a price, a quantity or a lead time. If the cut sheet does not answer a heading, leave a [VERIFY: …] line rather than guessing.",
    example: "",
  },
  {
    key: "Lighting Controls",
    title: "Lighting Control Console or Processor",
    headings: [
      { label: "Basis of Design", guidance: "Manufacturer and model; note the software version if the sheet pins one." },
      { label: "Standards Compliance", guidance: "Listings, and the control standards implemented." },
      { label: "Capacity", guidance: "Parameter/universe count, playback count, cue and show storage." },
      { label: "Control Protocols", guidance: "DMX512-A, sACN, Art-Net, RDM, OSC, contact closures, network topology." },
      { label: "User Interface", guidance: "Faders, encoders, touchscreens, external display support." },
      { label: "Electrical", guidance: "Supply, UPS expectations, connector types." },
      { label: "Accessories", guidance: "Wings, remotes, racks, licences bought with the unit." },
    ],
    rules: "Same voice as fixtures. Describe capability, not configuration — the show file is not a spec.",
    example: "",
  },
  {
    key: "Hoists",
    title: "Packaged Hoist",
    headings: [
      { label: "Basis of Design", guidance: "Manufacturer and model." },
      { label: "Standards Compliance", guidance: "ANSI E1.6 series, ASME, UL listings, and the AHJ requirements the sheet claims." },
      { label: "Capacity and Travel", guidance: "Working load, batten length served, travel, speed." },
      { label: "Machine", guidance: "Motor, gearbox, brake arrangement (including the secondary brake), drum or chain type." },
      { label: "Control", guidance: "Controller family, position feedback, limits, E-stop chain." },
      { label: "Safety", guidance: "Overload sensing, slack-line detection, secondary brake test, load-cell monitoring." },
      { label: "Finish", guidance: "Paint or plating and the colour." },
    ],
    rules: "Safety clauses are requirements, never options. Cite the standard by number.",
    example: "",
  },
  {
    key: "Rigging Hardware",
    title: "Rigging Hardware",
    headings: [
      { label: "Basis of Design", guidance: "Manufacturer and model or part number." },
      { label: "Standards Compliance", guidance: "ANSI E1.x, ASME B30, and any listing the sheet claims." },
      { label: "Material and Finish", guidance: "Alloy, plating or paint, and corrosion requirements." },
      { label: "Working Load", guidance: "Working load limit and design factor as stated by the manufacturer." },
      { label: "Fabrication", guidance: "Welds, swages, and what must be shop-assembled rather than field-made." },
    ],
    rules: "Never state a working load the cut sheet does not. Design factor belongs beside the load.",
    example: "",
  },
  {
    key: "Speakers",
    title: "Loudspeaker",
    headings: [
      { label: "Basis of Design", guidance: "Manufacturer and model." },
      { label: "Standards Compliance", guidance: "Listings, and the suspension standard where the sheet claims one." },
      { label: "Transducers", guidance: "Driver complement, sizes, voice-coil diameters." },
      { label: "Performance", guidance: "Frequency range, sensitivity, maximum SPL, nominal coverage, impedance or amplifier pairing." },
      { label: "Rigging and Mounting", guidance: "Integral rigging, bracket options, safety requirements." },
      { label: "Connections", guidance: "Connector type and count, passive/bi-amp wiring." },
      { label: "Finish", guidance: "Enclosure material, grille, colour options." },
    ],
    rules: "Quote performance figures only as the sheet measures them; name the measurement condition when the sheet does.",
    example: "",
  },
  {
    key: "Soft Goods",
    title: "Soft Goods",
    headings: [
      { label: "Basis of Design", guidance: "Fabric by name and weight; the fabricator where the project names one." },
      { label: "Material", guidance: "Fibre, weight in ounces, weave, and the flame-retardant treatment or inherent rating." },
      { label: "Color", guidance: "Colour by the mill's name; say when it is to be selected." },
      { label: "Fabrication", guidance: "Fullness, seams, hems, lining, chain pocket or sandbag pockets, webbing and grommets." },
      { label: "Hang Method", guidance: "Tie lines, snap hooks, carriers, or velcro — and their spacing." },
    ],
    rules: "Flame-retardant compliance is NFPA 701; say which test and whether the treatment is inherent or applied. Curtains dropped in The Grid use their own curtain templates — this formula is for everything else sewn.",
    example: "",
  },
];

export async function allTemplates(): Promise<SpecTemplate[]> {
  const list = await listDocs<Doc>("spec_templates");
  return list.map(normalize).sort((a, b) => a.key.localeCompare(b.key));
}

export async function getTemplate(id: string): Promise<SpecTemplate | null> {
  const raw = await getDoc<Doc>("spec_templates", id);
  return raw ? normalize(raw) : null;
}

export async function saveTemplate(
  input: Omit<SpecTemplate, "id" | "updatedAt" | "updatedBy">,
  by: string
): Promise<SpecTemplate> {
  const rec = normalize({ ...input, id: templateId(input.key), updatedAt: Date.now(), updatedBy: by });
  if (!rec.id) throw new Error("A template needs a key.");
  await upsertDoc<SpecTemplate>("spec_templates", rec);
  return rec;
}

export async function deleteTemplate(id: string): Promise<void> {
  await softDeleteDoc("spec_templates", id);
}

/**
 * Idempotent by key — never overwrites a formula someone edited. Called from
 * `seedIfEmpty()` regardless of the demo-data flag, because the go-live reset
 * wipes every doc collection (`DEMO_COLLECTIONS` is `Object.keys(DOC_TABLES)`)
 * and the formulas are configuration, not demo data.
 */
export async function seedStarterTemplates(by = "Peak"): Promise<number> {
  const have = new Set((await allTemplates()).map((t) => t.id));
  let made = 0;
  for (const t of STARTER_TEMPLATES) {
    if (have.has(templateId(t.key))) continue;
    await saveTemplate(t, by);
    made++;
  }
  return made;
}

/**
 * Owner decision (2026-09-25): the formulas auto-seed when empty on ANY
 * environment — `seedIfEmpty()` only runs on local dev, and a hosted database
 * (or one after a go-live reset) would otherwise show an empty Templates
 * screen and an empty "Insert template" row. Seeds a collection only when it
 * holds no live record at all, so deleting one formula does not bring it
 * back; deleting every formula does (the Restore button is the explicit path).
 * Called from read paths (server components), so it must not call
 * revalidatePath. Cheap on the hot path: one listDocs per collection.
 */
export async function ensureStarterTemplates(by = "Peak"): Promise<number> {
  const { allCurtainTemplates, seedStarterCurtainTemplates } = await import("@/lib/stores/spec-curtain-templates");
  let made = 0;
  if ((await allTemplates()).length === 0) made += await seedStarterTemplates(by);
  if ((await allCurtainTemplates()).length === 0) made += await seedStarterCurtainTemplates(by);
  return made;
}

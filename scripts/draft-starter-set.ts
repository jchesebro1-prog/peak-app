/**
 * Draft the catalog beta starter set + connection-metadata worksheet for
 * Jeff's review (punch #39, catalog beta build-out, Task 7).
 *
 * CRITICAL: this script NEVER touches the database and NEVER calls upsert.
 * It reads two JSON dumps and writes three review artifacts. The starter set
 * only becomes real catalog data when someone runs an import script against
 * scripts/starter-import-data.json AFTER Jeff has reviewed it and said so.
 *
 *   npx tsx scripts/draft-starter-set.ts
 *
 * Inputs:
 *   - scripts/catalog-import-data.json  — the 10,702 already-imported parts
 *     (existing DB). Required.
 *   - dealer-import-data.json (repo root) — the converted dealer sheets
 *     (14,674 rows), produced by scripts/convert-dealer-sheets.py from
 *     /Volumes/Claude/Peak Import. Optional: if absent, every sheet-sourced
 *     group section is written as PENDING VOLUME instead of failing.
 *
 * Outputs (all three always written together, even if the sheet is absent):
 *   - docs/catalog/STARTER-SET-2026-07-DRAFT.md
 *   - docs/catalog/METADATA-WORKSHEET-2026-07.md
 *   - scripts/starter-import-data.json
 *
 * Selection method: each of the six groups below is a hand-curated pick list
 * (brand + exact-SKU / keyword-narrowed heuristic — see the comments on each
 * group for the reasoning) rather than a generic top-N scorer. The dealer
 * sheets are uneven enough (see notes) that a generic scorer would surface
 * as much junk as signal; picking by known-good SKU per manufacturer is the
 * "keyword heuristic" the brief allows, taken to its most precise case. The
 * script is deterministic: given the same two input files it always resolves
 * the same picks in the same order — no Date.now(), no Math.random(), no
 * environment-dependent sort.
 *
 * A pick that no longer resolves (sku disappeared from a regenerated input)
 * is logged and skipped, not a hard failure — this stays a draft tool.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GROUP_TRADES, type CatalogGroup, type Trade } from "../src/lib/catalog-taxonomy";
import { CONNECTION_TYPES, type Port, type PortDirection } from "../src/lib/catalog-connect";

const REPO_ROOT = join(__dirname, "..");
const DB_PATH = join(REPO_ROOT, "scripts", "catalog-import-data.json");
const SHEET_PATH = join(REPO_ROOT, "dealer-import-data.json");

const OUT_DRAFT_MD = join(REPO_ROOT, "docs", "catalog", "STARTER-SET-2026-07-DRAFT.md");
const OUT_WORKSHEET_MD = join(REPO_ROOT, "docs", "catalog", "METADATA-WORKSHEET-2026-07.md");
const OUT_IMPORT_JSON = join(REPO_ROOT, "scripts", "starter-import-data.json");

/* ---------------------------------------------------------------- types --*/

type SourceRow = {
  sku: string;
  desc: string;
  category: string;
  unit: string;
  list: number;
  cost: number;
  mfr?: string;
  note?: string;
};

type Source = "DB" | "sheet";

type Pick = {
  sku: string;
  ports: Port[];
  /** Parenthetical uncertainty note appended after the ports summary. */
  portNote?: string;
  /** Overrides the row's own converter note (e.g. the Biamp identity gap,
   *  which isn't a price problem — the converter didn't flag it at all). */
  forcedNote?: string;
};

type DraftItem = {
  sku: string;
  desc: string;
  category: string; // original source category, kept for the draft table
  unit: string;
  list: number;
  cost: number;
  mfr: string;
  note?: string;
  group: CatalogGroup;
  trade: Trade;
  source: Source;
  ports: Port[];
  portNote?: string;
};

/* ------------------------------------------------------------- loading --*/

function loadDB(): SourceRow[] {
  if (!existsSync(DB_PATH)) {
    throw new Error(`Required input missing: ${DB_PATH}`);
  }
  return JSON.parse(readFileSync(DB_PATH, "utf8"));
}

function loadSheet(): SourceRow[] | null {
  if (!existsSync(SHEET_PATH)) return null;
  return JSON.parse(readFileSync(SHEET_PATH, "utf8"));
}

/* ------------------------------------------------------- port builders --*/
/* Domain defaults by product type (brief's own examples: console = DMX512
 * out + sACN/Art-Net io; passive speaker = speakON in; amp = XLR in +
 * speakON out; DSP = Dante io + XLR io; video switcher = HDMI in×N/out;
 * hoist motor = motor power in + pendant control in). Uncertain ones get an
 * explicit "(verify — …)" portNote rather than a silent guess. */

const p = (name: string, direction: PortDirection, connectionType: string, count?: number): Port =>
  count !== undefined ? { name, direction, connectionType, count } : { name, direction, connectionType };

const consolePorts = (): Port[] => [
  p("DMX Out", "out", "DMX512 (5-pin XLR)", 2),
  p("Network (sACN/Art-Net)", "io", "sACN/Art-Net (etherCON/Cat6)"),
];

const wingPorts = (): Port[] => [
  p("Console Link (sACN/Art-Net)", "io", "sACN/Art-Net (etherCON/Cat6)"),
];

const dimmerRackPorts = (outCount: number): Port[] => [
  p("DMX In", "in", "DMX512 (5-pin XLR)"),
  p("RDM", "io", "RDM"),
  p("Dimmed Power Out", "out", "stage pin", outCount),
];

const conventionalFixturePorts = (): Port[] => [p("Power In", "in", "Edison")];

const ledFixturePorts = (): Port[] => [
  p("DMX In", "in", "DMX512 (5-pin XLR)"),
  p("DMX Thru", "out", "DMX512 (5-pin XLR)"),
  p("Power In", "in", "powerCON/True1"),
];

const ptzCameraPorts = (video: "HDMI" | "SDI/BNC"): Port[] => [p("Video Out", "out", video)];

const encoderDecoderPorts = (): Port[] => [p("HDMI", "io", "HDMI")];

const sdiCardPorts = (n: number): Port[] => [p("SDI In", "in", "SDI/BNC", n)];

const captureOnlyPorts = (): Port[] => [p("HDMI In", "in", "HDMI")];

const matrixPorts = (inN: number, outN: number, io: "HDMI" | "HDBaseT (Cat6a)" = "HDBaseT (Cat6a)"): Port[] => [
  p("HDMI In", "in", "HDMI", inN),
  p(io === "HDMI" ? "HDMI Out" : "HDBaseT Out", "out", io, outN),
];

const hdbasetMatrixPorts = (inN: number, outN: number): Port[] => [
  p("HDBaseT In", "in", "HDBaseT (Cat6a)", inN),
  p("HDBaseT Out", "out", "HDBaseT (Cat6a)", outN),
];

const extenderKitPorts = (): Port[] => [
  p("HDMI In (TX)", "in", "HDMI"),
  p("HDBaseT Out (RX)", "out", "HDBaseT (Cat6a)"),
];

const splitterPorts = (outN: number): Port[] => [
  p("HDMI In", "in", "HDMI"),
  p("HDMI Out", "out", "HDMI", outN),
];

const passiveSpeakerPorts = (): Port[] => [p("Audio In", "in", "speakON NL2")];

const seventyVSpeakerPorts = (): Port[] => [p("Audio In (70V)", "in", "70V pair")];

const poweredSpeakerPorts = (): Port[] => [
  p("Audio In", "in", "XLR line/mic"),
  p("Power In", "in", "powerCON/True1"),
];

const mixerAllInOnePorts = (): Port[] => [
  p("XLR In", "in", "XLR line/mic"),
  p("XLR Out", "out", "XLR line/mic"),
  p("Network (Dante/AES67)", "io", "Dante/AES67 (Cat6)"),
];

const mixSurfacePorts = (): Port[] => [p("Network to MixRack (Dante/AES67)", "io", "Dante/AES67 (Cat6)")];

const mixRackPorts = (inN: number, outN: number): Port[] => [
  p("XLR In", "in", "XLR line/mic", inN),
  p("XLR Out", "out", "XLR line/mic", outN),
  p("Network (Dante/AES67)", "io", "Dante/AES67 (Cat6)"),
];

const mechanicalPorts = (): Port[] => [];

const motorHoistPorts = (): Port[] => [
  p("Motor Power In", "in", "motor power"),
  p("Pendant Control In", "in", "low-voltage pendant control"),
];

/* ------------------------------------------------------------- picks ----*/
/* Selection bar (binding, per the plan/brief) — breadth over depth, ≥2
 * manufacturers per group, ~8-15 items per group. Every pick below is a
 * flagship/common item chosen by brand + desc keyword; see the reasoning
 * inline where a group needed a judgment call. */

const LIGHTING_CONTROLS_DB: Pick[] = [
  // ETC consoles — flagship large-format down to compact/budget.
  { sku: "ETC:ION XE 2K-US", ports: consolePorts() },
  { sku: "ETC:ELEMENT 2 1K", ports: consolePorts() },
  { sku: "ETC:CS40", ports: consolePorts() },
  // ETC dimming — a portable Sensor3 rack (touring) + a rack dimmer module
  // (architectural). Connector on the portable pack is stated in the desc;
  // the module's downstream connector depends on the rack it lands in.
  { sku: "ETC:SP3-1220B", ports: dimmerRackPorts(12) },
  {
    sku: "ETC:D20AF",
    ports: dimmerRackPorts(2),
    portNote: "(verify — dimmed-output connector depends on host rack)",
  },
];

const LIGHTING_CONTROLS_SHEET: Pick[] = [
  // ChamSys, from the Chauvet dealer sheet's CHAMSYS tab (per selection bar).
  { sku: "ChamSys:CHAMMQ50", ports: consolePorts() },
  { sku: "ChamSys:CHAMMQ70", ports: consolePorts() },
  { sku: "ChamSys:CHAMQUICKQ10", ports: consolePorts() },
  { sku: "ChamSys:CHAMQUICKQ20", ports: consolePorts() },
  { sku: "ChamSys:CHAMMQCOMPWING", ports: wingPorts() },
  { sku: "ChamSys:CHAMMQ500MPLUSWITHCASE", ports: consolePorts() },
];

const FIXTURES_DB: Pick[] = [
  // ETC — classic tungsten ellipsoidal/fresnel (dimmed externally, no DMX
  // on the fixture itself) plus the LED lineup (DMX + power on-fixture).
  {
    sku: "ETC:405",
    ports: conventionalFixturePorts(),
    portNote: "(verify — dimmed via external rack; connector per whip/bare-end order)",
  },
  {
    sku: "ETC:FRES7",
    ports: conventionalFixturePorts(),
    portNote: "(verify — dimmed via external rack; connector per whip/bare-end order)",
  },
  { sku: "ETC:4ML-27/90-FD-P", ports: ledFixturePorts() },
  { sku: "ETC:CSPAR", ports: ledFixturePorts() },
  { sku: "ETC:SELD22H-I", ports: ledFixturePorts() },
];

const FIXTURES_SHEET: Pick[] = [
  // Chauvet Professional — wash, panel, and two moving-head families.
  { sku: "Chauvet Professional:COLORADO1SOLO", ports: ledFixturePorts() },
  { sku: "Chauvet Professional:COLORADOPANELQ40", ports: ledFixturePorts() },
  { sku: "Chauvet Professional:MAVERICKFORCEXSPOT", ports: ledFixturePorts() },
  { sku: "Chauvet Professional:MAVERICKFORCE2BEAMWASH", ports: ledFixturePorts() },
  { sku: "Chauvet Professional:COLORSTRIKEMV2", ports: ledFixturePorts() },
];

const VIDEO_CONTROLS_SHEET: Pick[] = [
  // BirdDog — two PTZ cameras, an HDMI encoder/decoder, an openGear card.
  { sku: "BirdDog:BDA200", ports: ptzCameraPorts("SDI/BNC") },
  { sku: "BirdDog:BDP100B", ports: ptzCameraPorts("SDI/BNC") },
  { sku: "BirdDog:BD4KHDMI", ports: encoderDecoderPorts() },
  { sku: "BirdDog:BDOG4", ports: sdiCardPorts(4) },
  // Matrox — the three Monarch encoders. Streaming/network output isn't in
  // CONNECTION_TYPES yet (see worksheet notes); only the HDMI capture input
  // is modeled.
  {
    sku: "Matrox:MHD/I",
    ports: captureOnlyPorts(),
    portNote: "(verify — network/streaming output not modeled; capture input only)",
  },
  {
    sku: "Matrox:MHDX/I",
    ports: captureOnlyPorts(),
    portNote: "(verify — network/streaming output not modeled; capture input only)",
  },
  {
    sku: "Matrox:MHLCS/I",
    ports: captureOnlyPorts(),
    portNote: "(verify — network/streaming output not modeled; capture input only)",
  },
  // AVPro Edge — an HDBaseT matrix, a conferencing auto-switch matrix, an
  // extender kit, and a distribution splitter.
  { sku: "AVPro Edge:AC-AXION-8", ports: matrixPorts(8, 8) },
  { sku: "AVPro Edge:AC-CX-84", ports: hdbasetMatrixPorts(8, 4) },
  { sku: "AVPro Edge:AC-EX70-UHD-KIT", ports: extenderKitPorts(), portNote: "(kit = TX+RX pair, one line item)" },
  { sku: "AVPro Edge:AC-DA14-AUHD-GEN2", ports: splitterPorts(4) },
];

const SPEAKERS_SHEET: Pick[] = [
  // Meyer Sound — line array element, two subs, a point-source, a compact.
  // Every Meyer row in the sheet carries a converter "verify" note (cost=0,
  // headerless-parse sourced) — included anyway; Speakers falls below its
  // 2-manufacturer floor without Meyer (Danley is also 100% noted).
  { sku: "Meyer Sound:LEOPARD", ports: poweredSpeakerPorts() },
  { sku: "Meyer Sound:900-LFC", ports: poweredSpeakerPorts() },
  { sku: "Meyer Sound:UPQ-D1", ports: poweredSpeakerPorts() },
  { sku: "Meyer Sound:USW-112XP", ports: poweredSpeakerPorts() },
  { sku: "Meyer Sound:MM-4XP", ports: poweredSpeakerPorts() },
  // Danley — the TH121 (both touring and install variants have plausible
  // prices), Studio, and Signature. Several other Danley family rows were
  // hand-excluded as garbage (see draft notes: implausible sub-$300 prices
  // for full loudspeaker cabinets — parser artifacts, not real prices).
  {
    sku: "Danley:TH121-T",
    ports: passiveSpeakerPorts(),
    portNote: "(verify — passive vs. powered not specified in the sheet)",
  },
  {
    sku: "Danley:TH121-I-B",
    ports: passiveSpeakerPorts(),
    portNote: "(verify — passive vs. powered not specified in the sheet)",
  },
  {
    sku: "Danley:STUDIO SERIES",
    ports: passiveSpeakerPorts(),
    portNote: "(verify — passive vs. powered not specified in the sheet)",
  },
  {
    sku: "Danley:SIGNATURE",
    ports: passiveSpeakerPorts(),
    portNote: "(verify — passive vs. powered not specified in the sheet)",
  },
  // Tannoy — clean rows (Music Tribe Nov 2025 sourced; see draft notes),
  // spread across ceiling/surface/pendant mounting.
  {
    sku: "Tannoy:TA-CVS8",
    ports: passiveSpeakerPorts(),
    portNote: "(verify — many install ceiling speakers are 70V-tapped; confirm before wiring)",
  },
  { sku: "Tannoy:TA-CMS803DC-PI", ports: passiveSpeakerPorts() },
  { sku: "Tannoy:TA-AMS8DC-BK", ports: passiveSpeakerPorts() },
  { sku: "Tannoy:TA-DVS8-BK", ports: passiveSpeakerPorts() },
  { sku: "Tannoy:TA-OCV6-BK", ports: passiveSpeakerPorts() },
];

const AUDIO_CONTROLS_SHEET: Pick[] = [
  // Biamp — every one of the 1,148 dealer rows has desc identical to sku
  // (a bare part number; no product name anywhere in the sheet). These 3
  // are the highest-list-price DISTINCT price points, a deterministic
  // stand-in for "probably a substantial rack unit" — NOT a verified model.
  // See draft notes: this is a data-quality gap, not a price-verify flag.
  {
    sku: "", // filled at runtime — see pickBiampPlaceholders()
    ports: [],
    portNote: "(verify — product unidentified, no product type to draft ports from)",
    forcedNote: "verify — product unidentified (dealer sheet desc = part number only)",
  },
  {
    sku: "",
    ports: [],
    portNote: "(verify — product unidentified, no product type to draft ports from)",
    forcedNote: "verify — product unidentified (dealer sheet desc = part number only)",
  },
  {
    sku: "",
    ports: [],
    portNote: "(verify — product unidentified, no product type to draft ports from)",
    forcedNote: "verify — product unidentified (dealer sheet desc = part number only)",
  },
  // Shure — Axient Digital PSM combiner/transmitter (RF distribution — no
  // antenna/RF connectionType exists yet, ports left empty) + an MXA901
  // ceiling-array bundle and IntelliMix DSP (both networked over Dante).
  {
    sku: "Shure:AD8CUS",
    ports: [],
    portNote: "(verify — RF combiner; no antenna/RF connectionType in current taxonomy)",
  },
  {
    sku: "Shure:ADTQUS=-G57",
    ports: [],
    portNote: "(verify — RF transmitter; no antenna/RF connectionType in current taxonomy)",
  },
  {
    sku: "Shure:MXA901W-R-PM-3/8-V",
    ports: [p("Audio Out", "out", "Dante/AES67 (Cat6)")],
    portNote: "(verify — confirm Dante vs. analog output for this bundle)",
  },
  { sku: "Shure:IMXF5", ports: [p("Audio (Dante/AES67)", "io", "Dante/AES67 (Cat6)")] },
  // Allen & Heath — an all-in-one mixer, an S-Class surface (no analog I/O
  // of its own — routes to its MixRack over Dante), and two MixRacks.
  { sku: "Allen & Heath:AH-AVANTIS-ULTRA", ports: mixerAllInOnePorts() },
  {
    sku: "Allen & Heath:AH-DLIVE-S5",
    ports: mixSurfacePorts(),
    portNote: "(S-Class surface has no analog I/O of its own — I/O lives on its MixRack)",
  },
  { sku: "Allen & Heath:AH-DLIVE-DM64-RUFX", ports: mixRackPorts(64, 32) },
  { sku: "Allen & Heath:AH-DLIVE-CDM32-RUFX", ports: mixRackPorts(32, 16) },
];

const CURTAINS_DB: Pick[] = [
  // Texas Scenic track + carriers — pure mechanical hardware, no ports.
  { sku: "Texas Scenic:101A", ports: mechanicalPorts() },
  { sku: "Texas Scenic:110S-20B", ports: mechanicalPorts() },
  { sku: "Texas Scenic:101B", ports: mechanicalPorts() },
  { sku: "Texas Scenic:102B", ports: mechanicalPorts() },
  { sku: "Texas Scenic:137", ports: mechanicalPorts() },
  { sku: "Texas Scenic:10", ports: mechanicalPorts() },
  // Thern hoists — manual (hand-crank, no ports) + motorized (motor power +
  // pendant control), spread across capacities and drive types.
  { sku: "Thern:CW11-1M", ports: mechanicalPorts() },
  { sku: "Thern:CW25-1M", ports: mechanicalPorts() },
  { sku: "Thern:CWA2-PC", ports: motorHoistPorts() },
  { sku: "Thern:CT40-xx", ports: motorHoistPorts() },
  { sku: "Thern:RD5-xx", ports: motorHoistPorts() },
];

/** Biamp has no usable desc text anywhere in the sheet (see AUDIO_CONTROLS_
 * SHEET comment) — pick the 3 highest DISTINCT list prices, deterministically
 * sorted (list desc, sku asc tiebreak), as breadth placeholders. */
function pickBiampPlaceholders(sheet: SourceRow[]): string[] {
  const rows = sheet
    .filter((r) => r.mfr === "Biamp")
    .slice()
    .sort((a, b) => b.list - a.list || a.sku.localeCompare(b.sku));
  const seenPrices = new Set<number>();
  const out: string[] = [];
  for (const r of rows) {
    if (seenPrices.has(r.list)) continue;
    seenPrices.add(r.list);
    out.push(r.sku);
    if (out.length === 3) break;
  }
  return out;
}

/* --------------------------------------------------------- resolution --*/

function resolve(pick: Pick, rows: SourceRow[], source: Source, group: CatalogGroup): DraftItem | null {
  const row = rows.find((r) => r.sku === pick.sku);
  if (!row) {
    console.warn(`[draft-starter-set] MISSING sku ${JSON.stringify(pick.sku)} in ${source} data — skipped`);
    return null;
  }
  if (row.cost <= 0 && row.list <= 0) {
    console.warn(`[draft-starter-set] SANITY SKIP ${pick.sku} — cost<=0 and list<=0`);
    return null;
  }
  return {
    sku: row.sku,
    desc: row.desc,
    category: row.category,
    unit: row.unit || "ea",
    list: row.list,
    cost: row.cost,
    mfr: row.mfr || "",
    note: pick.forcedNote ?? row.note,
    group,
    trade: GROUP_TRADES[group],
    source,
    ports: pick.ports,
    portNote: pick.portNote,
  };
}

type GroupResult = { group: CatalogGroup; items: DraftItem[]; sheetPending: boolean };

function buildGroup(
  group: CatalogGroup,
  dbRows: SourceRow[],
  sheetRows: SourceRow[] | null,
  dbPicks: Pick[],
  sheetPicks: Pick[]
): GroupResult {
  const items: DraftItem[] = [];
  const seen = new Set<string>();
  for (const pick of dbPicks) {
    const item = resolve(pick, dbRows, "DB", group);
    if (item && !seen.has(item.sku)) {
      seen.add(item.sku);
      items.push(item);
    }
  }
  const sheetPending = sheetPicks.length > 0 && sheetRows === null;
  if (sheetRows) {
    for (const pick of sheetPicks) {
      const item = resolve(pick, sheetRows, "sheet", group);
      if (item && !seen.has(item.sku)) {
        seen.add(item.sku);
        items.push(item);
      }
    }
  }
  return { group, items, sheetPending };
}

/* ------------------------------------------------------------- main ----*/

function main() {
  const dbRows = loadDB();
  const sheetRows = loadSheet();

  // Biamp picks need the sheet loaded first to resolve their skus.
  const audioControlsSheet = AUDIO_CONTROLS_SHEET.slice();
  if (sheetRows) {
    const biampSkus = pickBiampPlaceholders(sheetRows);
    let bi = 0;
    for (let i = 0; i < audioControlsSheet.length; i++) {
      if (audioControlsSheet[i].sku === "" && bi < biampSkus.length) {
        audioControlsSheet[i] = { ...audioControlsSheet[i], sku: biampSkus[bi] };
        bi++;
      }
    }
  }

  const results: GroupResult[] = [
    buildGroup("Lighting Controls", dbRows, sheetRows, LIGHTING_CONTROLS_DB, LIGHTING_CONTROLS_SHEET),
    buildGroup("Fixtures", dbRows, sheetRows, FIXTURES_DB, FIXTURES_SHEET),
    buildGroup("Video Controls", dbRows, sheetRows, [], VIDEO_CONTROLS_SHEET),
    buildGroup("Speakers", dbRows, sheetRows, [], SPEAKERS_SHEET),
    buildGroup("Audio Controls", dbRows, sheetRows, [], audioControlsSheet),
    buildGroup("Curtains", dbRows, sheetRows, CURTAINS_DB, []),
  ];

  writeFileSync(OUT_DRAFT_MD, buildDraftMd(results, sheetRows !== null));
  writeFileSync(OUT_WORKSHEET_MD, buildWorksheetMd(results));
  writeFileSync(OUT_IMPORT_JSON, buildImportJson(results));

  console.log("Wrote:");
  console.log("  " + OUT_DRAFT_MD);
  console.log("  " + OUT_WORKSHEET_MD);
  console.log("  " + OUT_IMPORT_JSON);
  console.log("");
  for (const r of results) {
    const mfrs = new Set(r.items.map((i) => i.mfr));
    console.log(`${r.group}: ${r.items.length} items, ${mfrs.size} manufacturers (${[...mfrs].join(", ")})`);
  }
  const total = results.reduce((n, r) => n + r.items.length, 0);
  console.log(`TOTAL: ${total} items across ${results.length} groups`);
}

/* --------------------------------------------------------- formatting --*/

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function portsSummary(item: DraftItem): string {
  if (item.ports.length === 0) {
    return item.portNote ? `(no ports) ${item.portNote}` : "(no ports)";
  }
  const parts = item.ports.map((p) => `${p.name} [${p.direction}${p.count ? ` ×${p.count}` : ""}: ${p.connectionType}]`);
  return parts.join("; ") + (item.portNote ? ` ${item.portNote}` : "");
}

function buildDraftMd(results: GroupResult[], sheetPresent: boolean): string {
  const lines: string[] = [];
  lines.push("# Starter Set — Draft (2026-07)");
  lines.push("");
  lines.push("**Nothing below is imported. Jeff: mark rows to drop, then say \"import the starter set\".**");
  lines.push("");
  lines.push(
    "Generated by `scripts/draft-starter-set.ts` from `scripts/catalog-import-data.json` (existing DB, 10,702 parts) " +
      (sheetPresent
        ? "and `dealer-import-data.json` (converted dealer sheets, 14,674 rows)."
        : "— `dealer-import-data.json` was NOT present at generation time, so every dealer-sourced section below is marked PENDING VOLUME.")
  );
  lines.push(
    "Sanity-passed by hand per the task brief: obvious parser garbage removed, cost<=0-AND-list<=0 rows skipped, " +
      "duplicates deduped by SKU. Punch #39, catalog beta build-out, Task 7."
  );
  lines.push("");
  lines.push(
    "Columns: Brand · SKU · Description · Cost/List · Source (DB = existing catalog, sheet = converted dealer price " +
      "list) · Trade · Draft ports (see the metadata worksheet for the full per-item ports table and the connection " +
      "taxonomy Jeff is pruning)."
  );
  lines.push("");

  for (const r of results) {
    lines.push(`## ${r.group}  (${GROUP_TRADES[r.group]})`);
    lines.push("");
    if (r.items.length === 0) {
      lines.push(r.sheetPending ? "_PENDING VOLUME — dealer-import-data.json was not present._" : "_No items resolved._");
      lines.push("");
      continue;
    }
    const mfrs = new Set(r.items.map((i) => i.mfr));
    lines.push(`${r.items.length} items · ${mfrs.size} manufacturer(s): ${[...mfrs].sort().join(", ")}`);
    lines.push("");
    lines.push("| Brand | SKU | Description | Cost | List | Source | Trade | Draft ports | Flag |");
    lines.push("|---|---|---|---|---|---|---|---|---|");
    for (const item of r.items) {
      const flag = item.note ? item.note : "";
      lines.push(
        `| ${item.mfr} | \`${item.sku}\` | ${item.desc.replace(/\|/g, "/")} | ${money(item.cost)} | ${money(item.list)} | ${item.source} | ${item.trade} | ${portsSummary(item)} | ${flag} |`
      );
    }
    lines.push("");
  }

  lines.push("## Notes");
  lines.push("");
  lines.push(
    "- **Draper — held out entirely, not just \"base-only\".** The converter (`scripts/convert-dealer-sheets.py`, " +
      "`HELD_OUT`) excludes Draper Dealer Pricing April 2026.xlsx completely: it's a configurator-style size-matrix " +
      "sheet (tens of thousands of size-permutation rows), and importing it needs its own decision, not a starter-set " +
      "trim. That's a stronger cut than Jeff's \"base-only\" call — flagging for his read before Draper is touched at " +
      "all, in either direction."
  );
  lines.push(
    "- **Ape Riggers — dropped per Jeff**, and separately the converter holds out the only Ape Riggers sheet in the " +
      "folder as unusable (2014 scan, OCR output unparseable — e.g. one row read \"eo7.0e\"). Not included here; not " +
      "recommended to revisit without a current sheet from the vendor."
  );
  lines.push(
    "- **Tannoy provenance.** Every `mfr: \"Tannoy\"` row in `dealer-import-data.json` is guaranteed to come from the " +
      "Music Tribe Nov 2025 sheet, not the older June 2023 Tannoy-only sheet — the converter holds the June 2023 file " +
      "out completely (`HELD_OUT`, \"superseded by Music Tribe Nov 2025\"), so it never reaches the JSON at all. The " +
      "rows don't carry a literal `mfr: \"Music Tribe\"` tag because the converter resolves each Music-Tribe-sheet tab " +
      "to its real brand name (Tannoy, Midas, Klark Teknik, Lab Gruppen, Lake, Turbosound, Behringer) — so `mfr: " +
      "\"Tannoy\"` IS the Music Tribe selection the plan asked for, just resolved one level deeper than the brief's " +
      "wording implied."
  );
  lines.push(
    "- **Manufacturers whose entire dealer-sheet population carries a converter \"verify\" note**: ChamSys, Chauvet " +
      "Professional, Danley, and Meyer Sound are 100% flagged (mostly `verify price (list-only sheet)` — no dealer " +
      "cost column, or `verify price (headerless rows)` — the sheet had no column headers at all). Shure is 100% " +
      "flagged too (mostly headerless-parse artifacts). Per the sanity rule, rows with a verify note are normally " +
      "skipped — but excluding them entirely would drop Lighting Controls, Fixtures, Speakers, and Audio Controls " +
      "each below their required manufacturer floor, so a curated subset from each is included anyway and flagged in " +
      "the Flag column. Verify pricing (and, for Danley/Meyer, product identity) against the vendor before import."
  );
  lines.push(
    "- **Biamp — a data-quality gap, not a price-verify flag.** All 1,148 Biamp rows in the dealer sheet have `desc` " +
      "identical to `sku` (a bare part number; no product name survived conversion anywhere in the sheet). The 3 " +
      "Biamp rows included here are the highest-list-price *distinct* price points, picked only as deterministic " +
      "breadth placeholders — their actual product identity is unconfirmed. Do not import these without looking each " +
      "part number up in Biamp's price book first."
  );
  lines.push(
    "- **Danley price-plausibility filter.** Several Danley dealer rows were excluded even though they pass the " +
      "cost/list sanity check: rows like `SH SERIES` / `GH SERIES` / `FLEX SERIES` etc. carry list prices of $12–$180, " +
      "implausible for a full loudspeaker cabinet — almost certainly a config/option code the headerless parser " +
      "mistook for a price. Also excluded as outright parser garbage: `Danley:February` (desc `\"16, 2026\"`, a date " +
      "fragment) and the two `❖ Orders totaling …` rows (terms-of-sale text, not products)."
  );
  lines.push(
    "- **Video/network taxonomy gap.** BirdDog's PTZ cameras/encoders and Matrox's encoders are NDI/network-first " +
      "devices; `CONNECTION_TYPES` (src/lib/catalog-connect.ts) has no generic Ethernet/NDI entry, only `HDBaseT " +
      "(Cat6a)` and `sACN/Art-Net (etherCON/Cat6)` (lighting-specific). Ports below model only the certain physical " +
      "side (HDMI/SDI); the network side is left unmodeled rather than mapped onto a connection type that doesn't " +
      "really fit. Jeff may want to add a generic network/NDI connectionType — see the worksheet."
  );
  lines.push(
    "- **RF taxonomy gap.** Shure's Axient Digital PSM combiner/transmitter items are RF distribution hardware — " +
      "there's no antenna/RF connectionType in the current taxonomy, so those two rows carry empty ports arrays " +
      "rather than a fabricated match."
  );
  lines.push(
    "- **No per-part `trade` in the import JSON.** Each group's `category` above is the group name itself, which " +
      "already resolves to the right trade via the admin-editable category→{group,trade} map (falling back to " +
      "`GROUP_TRADES`) — see `src/lib/catalog-taxonomy.ts`. A per-part trade would be redundant and would " +
      "permanently override any future admin remap of that category."
  );
  lines.push("");
  return lines.join("\n");
}

function buildWorksheetMd(results: GroupResult[]): string {
  const lines: string[] = [];
  lines.push("# Connection-Metadata Worksheet (2026-07)");
  lines.push("");
  lines.push(
    "Companion to `STARTER-SET-2026-07-DRAFT.md` (punch #39, catalog beta build-out, Task 7). Two parts: (1) the " +
      "`CONNECTION_TYPES` taxonomy for Jeff to prune, (2) draft ports for every starter-set item, by domain default " +
      "(a console = DMX512 out + sACN/Art-Net io; a passive speaker = speakON in; an amp = XLR in + speakON out; a " +
      "DSP = Dante io + XLR io; a video switcher = HDMI in×N/out; a hoist motor = motor power in + pendant control " +
      "in). Anything uncertain is marked **(verify)**."
  );
  lines.push("");
  lines.push("## 1. Connection types (`src/lib/catalog-connect.ts`, `CONNECTION_TYPES`) — prune candidates");
  lines.push("");
  lines.push("Jeff: strike anything Peak will never wire, or note additions needed (see the gaps flagged below).");
  lines.push("");
  const groups: Record<string, string[]> = {
    power: ["powerCON/True1", "Edison", "stage pin", "Socapex", "bare-end"],
    "lighting data": ["DMX512 (5-pin XLR)", "sACN/Art-Net (etherCON/Cat6)", "RDM", "contact closure"],
    audio: [
      "XLR line/mic",
      "speakON NL2",
      "speakON NL4",
      "speakON NL8",
      "Dante/AES67 (Cat6)",
      "AES/EBU",
      "70V pair",
    ],
    video: ["HDMI", "SDI/BNC", "HDBaseT (Cat6a)", "fiber"],
    rigging: ["motor power", "low-voltage pendant control"],
  };
  for (const [label, types] of Object.entries(groups)) {
    lines.push(`**${label}**`);
    for (const t of types) {
      const known = CONNECTION_TYPES.includes(t) ? "" : "  _(not found in CONNECTION_TYPES — check for a rename)_";
      lines.push(`- [ ] ${t}${known}`);
    }
    lines.push("");
  }
  lines.push(
    "**Gaps found while drafting ports below** — not in the list above; Jeff's call whether to add them:\n" +
      "- Generic network/NDI (no physical connector, e.g. BirdDog/Matrox streaming/control) — closest existing entry " +
      "is `HDBaseT (Cat6a)`, which is a physical-cable standard, not a fit.\n" +
      "- RF/antenna (wireless mic combiners and transmitters, e.g. Shure Axient PSM) — nothing in the list models RF."
  );
  lines.push("");

  lines.push("## 2. Draft ports by starter-set item");
  lines.push("");
  for (const r of results) {
    lines.push(`### ${r.group}`);
    lines.push("");
    if (r.items.length === 0) {
      lines.push(r.sheetPending ? "_PENDING VOLUME._" : "_No items._");
      lines.push("");
      continue;
    }
    lines.push("| SKU | Ports (name — direction — connectionType — count) |");
    lines.push("|---|---|");
    for (const item of r.items) {
      const cell =
        item.ports.length === 0
          ? item.portNote ?? "(no ports — mechanical/pure hardware)"
          : item.ports
              .map((p) => `${p.name} — ${p.direction} — ${p.connectionType}${p.count ? ` — ×${p.count}` : ""}`)
              .join("<br>") + (item.portNote ? `<br>${item.portNote}` : "");
      lines.push(`| \`${item.sku}\` | ${cell} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildImportJson(results: GroupResult[]): string {
  const rows = results.flatMap((r) =>
    r.items.map((item) => ({
      sku: item.sku,
      desc: item.desc,
      category: item.group, // identity map entry — resolves for free (Task 1)
      unit: item.unit,
      list: item.list,
      cost: item.cost,
      mfr: item.mfr,
      ...(item.note ? { note: item.note } : {}),
      // No per-part `trade` here on purpose: `category` above is always the
      // group name, which DEFAULT_CATEGORY_MAP/GROUP_TRADES already resolve
      // to the right trade (catalog-taxonomy.ts). Stamping trade here too
      // would be redundant AND would permanently shadow any future admin
      // remap of that category — tradeOf() prefers part.trade over the map.
      ports: item.ports,
    }))
  );
  return JSON.stringify(rows, null, 2) + "\n";
}

main();

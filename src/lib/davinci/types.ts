import type { Port } from "@/lib/catalog-connect";

export type DavinciDoc = {
  kind: "datasheet" | "manual";
  label: string;
  /** The manufacturer's own public URL. Never fetched server-side, never proxied. */
  url: string;
};

export type DavinciRecord = {
  typeId: string;
  displayName: string;
  category: string;
  /**
   * DaVinci's own manufacturer label (`constants.manufacturers[].text`) — one of
   * "ETC", "Echoflex", "High End Systems". Carried so the enricher can refuse to
   * put an ETC datasheet on a Draper part: SKU alone is NOT a safe key
   * (`Draper:450` and `Symetrix:4.50%` both normalize to ETC's `450`).
   * See DAVINCI_TO_PEAK_MFR in src/lib/catalog-davinci-apply.ts.
   */
  manufacturer: string;
  /**
   * False when DaVinci marks the type legacy or its `endActiveDate` has passed.
   * Used ONLY to break an identifier collision (buildIndex): 440 identifiers are
   * owned by more than one type and 25 of them resolved to a zero-port
   * discontinued record while a live one sat behind it.
   */
  active: boolean;
  /** Every model AND part number of this type, already through normalizeSku. */
  modelNumbers: readonly string[];
  ports: readonly Port[];
  docs: readonly DavinciDoc[];
  /**
   * DaVinci's plan-symbol image id (`visuals.data.imageId`) — braces stripped,
   * lower-case; absent when the type has none (#300). The file lives in the
   * gitignored export's `images/{<id>}.svg|png`.
   */
  planImageId?: string;
  /** Riser image id (`visuals.data.riserImageId`), same normalisation (#300). */
  riserImageId?: string;
};

/**
 * One end of a DaVinci accessory link (#207). Kept for EVERY type a link
 * touches — unlike `records`, which drops types with neither ports nor
 * documents, and lens tubes, clamps and cables are exactly those types.
 */
export type DavinciAccessoryType = {
  manufacturer: string;
  /** `typeInformation.productClassificationId` label: "Product", "Accessory", … */
  classification: string;
  /** Through normalizeSku, like DavinciRecord.modelNumbers. */
  modelNumbers: readonly string[];
};

/** `types[].accessories[]` — a fixture (parent) and a part it accepts. */
export type DavinciAccessoryLink = {
  parentTypeId: string;
  accessoryTypeId: string;
  maxQuantity: number;
  userDefinable: boolean;
};

/**
 * `library.json` `images[].imageMetadata` for one image id (#300). Kept only for
 * ids a record references, so the symbols import can recognise DaVinci's own
 * placeholder ("Unknown", type "Other" — VISUAL_UNKNOWN, the plan image of 705
 * records) and title a drawing by its own name ("UNISON UH1RS").
 */
export type DavinciImageMeta = { name: string; type: string };

export type DavinciExtract = {
  libraryTimestamp: string;
  generatedAt: number;
  records: readonly DavinciRecord[];
  /** Plan/riser image metadata by image id (#300). Optional so an older extract still loads. */
  images?: Readonly<Record<string, DavinciImageMeta>>;
  /** Part documents (#207). Optional so an extract written before it still loads. */
  accessoryTypes?: Readonly<Record<string, DavinciAccessoryType>>;
  accessoryLinks?: readonly DavinciAccessoryLink[];
};

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
  /** Every model AND part number of this type, already through normalizeSku. */
  modelNumbers: string[];
  ports: Port[];
  docs: DavinciDoc[];
};

export type DavinciExtract = {
  libraryTimestamp: string;
  generatedAt: number;
  records: DavinciRecord[];
};

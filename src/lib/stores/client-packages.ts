import { getBlob, setBlob } from "@/db/doc-store";

export type ClientPackageRecord = {
  id: string;
  projectId: string;
  fileName: string;
  blobPath: string;
  createdAt: number;
  createdBy: string;
  itemCount: number;
  datasheetCount: number;
  gapCount: number;
};

function id(): string {
  return "PKG-" + Math.random().toString(36).slice(2, 10).toUpperCase();
}

export async function saveClientPackage(input: Omit<ClientPackageRecord, "id" | "createdAt">): Promise<ClientPackageRecord> {
  const record: ClientPackageRecord = { ...input, id: id(), createdAt: Date.now() };
  const map = await getBlob<Record<string, ClientPackageRecord>>("client_packages", {});
  await setBlob("client_packages", { ...map, [record.id]: record });
  return record;
}

export async function getClientPackage(idValue: string): Promise<ClientPackageRecord | null> {
  const map = await getBlob<Record<string, ClientPackageRecord>>("client_packages", {});
  return map[idValue] || null;
}

export async function listClientPackages(projectId: string): Promise<ClientPackageRecord[]> {
  const map = await getBlob<Record<string, ClientPackageRecord>>("client_packages", {});
  return Object.values(map)
    .filter((record) => record.projectId === projectId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

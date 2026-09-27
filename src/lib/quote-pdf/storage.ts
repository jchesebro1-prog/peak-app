import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { blobEnabled, deleteBlob, getBlobStream, putBlob } from "@/lib/blob";

/**
 * Where saved quote PDFs live (#222). Vercel Blob (private) when
 * BLOB_READ_WRITE_TOKEN is set; otherwise, off Vercel, local files under
 * QUOTE_PDF_DIR (default <cwd>/.data/files) so dev works without a token. On
 * Vercel without a token there is nowhere durable to keep a file — callers get
 * `unavailable` and record it as the PDF's failure reason. Every path is
 * checked against isQuotePdfPath before any I/O. Server-only.
 *
 * The local store's reads carry `turbopackIgnore` comments: they take a
 * runtime path, and without the opt-out Turbopack's file tracer would ship the
 * whole project with every function that imports this module. Nothing here
 * needs tracing — on Vercel this store is never used.
 */

const PATH_RE = /^quote-pdfs\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+\.pdf$/;

export function isQuotePdfPath(p: unknown): p is string {
  return typeof p === "string" && PATH_RE.test(p) && !p.split("/").some((s) => s === "." || s === "..");
}

export type PdfStorage = {
  backend: "blob" | "fs";
  /** Returns the stored path (Blob adds a random suffix). */
  put(path: string, bytes: Buffer): Promise<string>;
  read(path: string): Promise<Buffer | null>;
  stream(path: string): Promise<ReadableStream | null>;
  remove(path: string): Promise<void>;
};

function guard(p: string): string {
  if (!isQuotePdfPath(p)) throw new Error("Refusing a storage path that isn't a quote PDF.");
  return p;
}

async function collect(s: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = s.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const blobStore: PdfStorage = {
  backend: "blob",
  async put(path, bytes) {
    return (await putBlob(guard(path), bytes, "application/pdf")).pathname;
  },
  async read(path) {
    try {
      const s = await getBlobStream(guard(path));
      return s ? await collect(s as ReadableStream<Uint8Array>) : null;
    } catch {
      return null;
    }
  },
  async stream(path) {
    return getBlobStream(guard(path));
  },
  async remove(path) {
    await deleteBlob(guard(path));
  },
};

function fsRoot(): string {
  return resolve(/*turbopackIgnore: true*/ process.env.QUOTE_PDF_DIR || join(process.cwd(), ".data", "files"));
}

function fsPath(p: string): string {
  const root = fsRoot();
  const full = resolve(/*turbopackIgnore: true*/ root, guard(p));
  if (!full.startsWith(root + sep)) throw new Error("Refusing a path outside the PDF store.");
  return full;
}

const fsStore: PdfStorage = {
  backend: "fs",
  async put(path, bytes) {
    const full = fsPath(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
    return path;
  },
  async read(path) {
    const full = fsPath(path);
    return existsSync(/*turbopackIgnore: true*/ full) ? readFile(/*turbopackIgnore: true*/ full) : null;
  },
  async stream(path) {
    const full = fsPath(path);
    return existsSync(/*turbopackIgnore: true*/ full)
      ? (Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ full)) as unknown as ReadableStream)
      : null;
  },
  async remove(path) {
    await rm(fsPath(path), { force: true });
  },
};

export function pdfStorage(): PdfStorage | { unavailable: string } {
  if (blobEnabled()) return blobStore;
  if (process.env.VERCEL) {
    return { unavailable: "File storage isn't configured (no BLOB_READ_WRITE_TOKEN) — the PDF can't be kept on this deployment." };
  }
  return fsStore;
}

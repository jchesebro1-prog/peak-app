import { hostnameIsUnsafe, resolveRedirectHop, validateIcsUrlSync } from "@/lib/venue-calendar-fetch";
import { MAX_PART_DOC_BYTES } from "./types";

/**
 * Server-side download of a manufacturer document URL (#DOC, spec §6).
 * Server-only. It reuses src/lib/venue-calendar-fetch.ts's SSRF guard
 * unchanged — http(s) only, the literal-host check, DNS resolution with
 * private/loopback/link-local refusal, and BOTH re-applied to every redirect
 * hop (`redirect: "manual"`) — and adds a document-sized body cap and
 * timeout. It never throws: every failure is `{ ok: false, error }` with a
 * reason the Datasheets page lists.
 *
 * `deps` exists for the spec harness (a fake fetch and a fake DNS check);
 * production passes nothing.
 */

export type FetchedFile = { bytes: Uint8Array; contentDisposition: string | null; finalUrl: string };
export type FetchDeps = {
  fetchImpl?: typeof fetch;
  isUnsafeHost?: (hostname: string) => Promise<boolean>;
  timeoutMs?: number;
  maxBytes?: number;
};

const FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

export async function fetchDocumentBytes(rawUrl: string, deps: FetchDeps = {}): Promise<{ ok: true; file: FetchedFile } | { ok: false; error: string }> {
  const doFetch = deps.fetchImpl ?? fetch;
  const unsafe = deps.isUnsafeHost ?? hostnameIsUnsafe;
  const maxBytes = deps.maxBytes ?? MAX_PART_DOC_BYTES;
  if (!/^https?:\/\//i.test(String(rawUrl ?? "").trim())) return { ok: false, error: "Only http(s) links can be fetched." };
  const first = validateIcsUrlSync(rawUrl);
  if (!first.ok) return first;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    let url = first.url;
    if (await unsafe(new URL(url).hostname)) return { ok: false, error: "That host isn't reachable from the server." };
    let res: Response;
    for (let hop = 0; ; hop++) {
      res = await doFetch(url, {
        headers: {
          Accept: "application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document, */*",
          "User-Agent": "peak-app/1.0 (Peak Systems Group part documents)",
        },
        signal: controller.signal,
        redirect: "manual",
      });
      const location = res.headers.get("location");
      if (!(res.status >= 300 && res.status < 400) || !location) break;
      if (hop >= MAX_REDIRECTS) return { ok: false, error: "Too many redirects." };
      const next = resolveRedirectHop(location, url);
      if (!next.ok) return next;
      if (await unsafe(new URL(next.url).hostname)) return { ok: false, error: "Redirected to a host that isn't reachable from the server." };
      url = next.url;
    }
    if (!res.ok) return { ok: false, error: `The link returned HTTP ${res.status}.` };
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > maxBytes) return { ok: false, error: "That file is over 25 MB." };

    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          controller.abort();
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          return { ok: false, error: "That file is over 25 MB." };
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
    return { ok: true, file: { bytes, contentDisposition: res.headers.get("content-disposition"), finalUrl: url } };
  } catch {
    if (controller.signal.aborted) return { ok: false, error: "The link took too long to respond." };
    return { ok: false, error: "Could not reach that link." };
  } finally {
    clearTimeout(timer);
  }
}

import { guardedFetchBytes, type GuardedFetchErrorText } from "@/lib/venue-calendar-fetch";
import { MAX_FETCH_TIMEOUT_MS, MAX_PART_DOC_BYTES } from "./types";

/**
 * Server-side download of a manufacturer document URL (#DOC, spec §6).
 * Server-only. It reuses src/lib/venue-calendar-fetch.ts's `guardedFetchBytes`
 * (review fix wave 1, I2) unchanged — http(s) only, the literal-host check,
 * DNS resolution with private/loopback/link-local refusal, and BOTH
 * re-applied to every redirect hop (`redirect: "manual"`) — the same one
 * guarded fetcher `fetchIcsWindows` uses, not a second implementation of the
 * guard. It never throws: every failure is `{ ok: false, error }` with a
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

const MAX_REDIRECTS = 5;

/** This caller's own wording for the four messages guardedFetchBytes lets a
 *  caller override — kept distinct from fetchIcsWindows's "Feed …" text. */
const PART_DOC_ERROR_TEXT: Required<GuardedFetchErrorText> = {
  httpStatus: (status) => `The link returned HTTP ${status}.`,
  tooLarge: "That file is over 25 MB.",
  timeout: "The link took too long to respond.",
  network: "Could not reach that link.",
};

export async function fetchDocumentBytes(rawUrl: string, deps: FetchDeps = {}): Promise<{ ok: true; file: FetchedFile } | { ok: false; error: string }> {
  if (!/^https?:\/\//i.test(String(rawUrl ?? "").trim())) return { ok: false, error: "Only http(s) links can be fetched." };

  const got = await guardedFetchBytes(rawUrl, {
    maxBytes: deps.maxBytes ?? MAX_PART_DOC_BYTES,
    timeoutMs: deps.timeoutMs ?? MAX_FETCH_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    accept: "application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document, */*",
    userAgent: "peak-app/1.0 (Peak Systems Group part documents)",
    deps: { fetchImpl: deps.fetchImpl, isUnsafeHost: deps.isUnsafeHost },
    errorText: PART_DOC_ERROR_TEXT,
  });
  if (!got.ok) return got;
  return { ok: true, file: { bytes: got.bytes, contentDisposition: got.contentDisposition, finalUrl: got.finalUrl } };
}

/**
 * Error taxonomy for the Krisp Meeting API (Recordings spec, "Krisp API
 * facts" + §2.4): every non-2xx from `lib/krisp/client.ts` is mapped onto one
 * of these so the import relay / poller can branch on `instanceof` instead
 * of string-matching Krisp's messages. `KrispBusyError` doubles as the
 * "one import in flight per Krisp account" signal — thrown both by the REST
 * client (Krisp's `400 "Action is still in process"`) and by the local
 * `withKrispImportLock` claim in `lib/krisp/connections.ts` — so a caller
 * requeues either the same way.
 */
export class KrispApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "KrispApiError";
    this.status = status;
  }
}

/** 401 — the key was revoked or is malformed; the rep must reconnect. */
export class KrispAuthError extends KrispApiError {
  constructor(message = "Krisp rejected the API key (401) — reconnect Krisp in Account.") {
    super(401, message);
    this.name = "KrispAuthError";
  }
}

/** 403 — storage full or a Read-only key trying to import (Krisp's own text is kept). */
export class KrispForbiddenError extends KrispApiError {
  constructor(message = "Krisp refused the request (403) — storage full or a Read-only key.") {
    super(403, message);
    this.name = "KrispForbiddenError";
  }
}

/** Another import is still in flight for this Krisp account — requeue, never `failed`. */
export class KrispBusyError extends KrispApiError {
  constructor(message = "A Krisp import is still in process for this account.", status = 400) {
    super(status, message);
    this.name = "KrispBusyError";
  }
}

/** 429 — 5 req/s sustained / 25 per 5 s burst per Krisp account. */
export class KrispRateLimitError extends KrispApiError {
  constructor(message = "Krisp rate limit reached (429) — try again shortly.") {
    super(429, message);
    this.name = "KrispRateLimitError";
  }
}

/** 409 — the meeting exists but transcription/notes are still processing. */
export class KrispNotReadyError extends KrispApiError {
  constructor(message = "The Krisp meeting is still processing (409).") {
    super(409, message);
    this.name = "KrispNotReadyError";
  }
}

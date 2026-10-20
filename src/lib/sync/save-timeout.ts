/* #344 C-final B — a server action that never answers (a dead-but-connected Wi-Fi) must not hang a capture editor's
   save for minutes: past the limit `saveThroughOutbox` treats it like a lost connection and queues the whole doc in
   the outbox. Pure; no DOM at import time. */

/** How long an online save may take before it becomes a queued (outbox) save. */
export const SAVE_ACTION_TIMEOUT_MS = 15_000;

export class SaveTimeoutError extends Error {
  constructor(ms: number) {
    super(`The server didn't answer within ${Math.round(ms / 1000)} s`);
    this.name = "SaveTimeoutError";
  }
}

/** `p`, or a SaveTimeoutError once `ms` passes first. No `ms` (or ≤ 0) = no limit. The late result is ignored. */
export function withSaveTimeout<T>(p: Promise<T>, ms?: number): Promise<T> {
  if (!ms || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SaveTimeoutError(ms)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

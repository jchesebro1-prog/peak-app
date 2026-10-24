/**
 * #368 — the ETC (my.etcconnect.com) API client. Server only.
 *
 * Fixed host — no caller-supplied URL, so no SSRF surface. Bearer auth with
 * the stored API secret (`etcSecret()`, the one decrypt) or, in tests, an
 * injected `apiKey` + `fetchImpl`. 30 s per request, `cache: "no-store"`.
 * Every call returns `{ ok: true, data } | { ok: false, status, message }`
 * with ETC's own message (v1 `{ error: { code, message } }` or v0
 * `{ traceId, message, code, details }`) — and never the secret, even if
 * ETC were to echo it.
 */
import { etcSecret } from "@/lib/dealer-api/connections";
import { ETC_LIST_LABEL, type EtcListKey } from "./parse";

export const ETC_HOST = "https://my.etcconnect.com";
export const ETC_TIMEOUT_MS = 30_000;

export type EtcResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export type EtcClientDeps = {
  fetchImpl?: typeof fetch;
  /** The API secret; default the stored one (`etcSecret()`). */
  apiKey?: string | null;
  timeoutMs?: number;
};

export type EtcAccount = { id: string; name: string; roleName: string };

/** ETC's message from either envelope, plain text only, ≤ 300 chars, the secret masked. */
export function etcErrorMessage(body: unknown, secret: string): string {
  let msg = "";
  if (body && typeof body === "object") {
    const b = body as { message?: unknown; error?: unknown };
    if (b.error && typeof b.error === "object" && typeof (b.error as { message?: unknown }).message === "string") msg = (b.error as { message: string }).message;
    else if (typeof b.error === "string") msg = b.error;
    else if (typeof b.message === "string") msg = b.message;
  } else if (typeof body === "string") msg = body;
  msg = msg.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (secret && secret.length >= 4) msg = msg.split(secret).join("••••");
  return msg.slice(0, 300) || "no message";
}

function failure(status: number, body: unknown, secret: string): { ok: false; status: number; message: string } {
  const etc = etcErrorMessage(body, secret);
  if (status === 401) return { ok: false, status, message: "ETC rejected the API key" };
  if (status === 403) return { ok: false, status, message: `This key's account can't see ETC pricing (ETC: ${etc})` };
  return { ok: false, status, message: `ETC returned ${status}: ${etc}` };
}

/** One GET against the fixed host. `path` is built here from encoded parts only. */
export async function etcFetch<T = unknown>(version: "v0" | "v1", path: string, deps: EtcClientDeps = {}): Promise<EtcResult<T>> {
  const secret = deps.apiKey === undefined ? await etcSecret() : deps.apiKey;
  if (!secret) return { ok: false, status: 0, message: "No ETC API key is saved" };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1, Math.min(deps.timeoutMs ?? ETC_TIMEOUT_MS, ETC_TIMEOUT_MS));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(`${ETC_HOST}/api/${version}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (ctrl.signal.aborted || (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError"))) {
      return { ok: false, status: 0, message: `ETC didn't answer in ${Math.round(timeoutMs / 1000)} s` };
    }
    // e.name only: a network error's message can carry the request.
    return { ok: false, status: 0, message: `Couldn't reach ETC (${e instanceof Error ? e.name : "network error"})` };
  }
  let body: unknown = null;
  let text = "";
  try {
    text = await res.text();
  } catch (e) {
    clearTimeout(timer);
    if (ctrl.signal.aborted) return { ok: false, status: 0, message: `ETC didn't answer in ${Math.round(timeoutMs / 1000)} s` };
    return { ok: false, status: res.status, message: `ETC's reply couldn't be read (${e instanceof Error ? e.name : "error"})` };
  }
  clearTimeout(timer);
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) return failure(res.status, body, secret);
  if (typeof body === "string" || body === null) return { ok: false, status: res.status, message: "ETC sent a reply that isn't JSON" };
  return { ok: true, data: body as T };
}

/** v1 `/me/business-accounts` — the key's business accounts. */
export async function listAccounts(deps: EtcClientDeps = {}): Promise<EtcResult<EtcAccount[]>> {
  const r = await etcFetch<{ data?: unknown }>("v1", "/me/business-accounts", deps);
  if (!r.ok) return r;
  const data = (r.data && typeof r.data === "object" ? (r.data as { data?: unknown }).data : null) as unknown;
  if (!Array.isArray(data)) return { ok: false, status: 200, message: "ETC's account list wasn't in the expected shape" };
  const accounts: EtcAccount[] = [];
  for (const a of data) {
    if (!a || typeof a !== "object") continue;
    const x = a as { id?: unknown; name?: unknown; roleName?: unknown };
    const id = x.id == null ? "" : String(x.id).trim();
    if (!id) continue;
    accounts.push({ id: id.slice(0, 120), name: String(x.name ?? "").trim().slice(0, 200) || id, roleName: String(x.roleName ?? "").trim().slice(0, 120) });
  }
  return { ok: true, data: accounts };
}

function listPath(accountId: string, tail: string): string {
  return `/pricing/business-account/${encodeURIComponent(accountId)}/${tail}`;
}

/** v0 full price list — `{ parts, categoryTree, repPricingCategories }` (parse with parsePriceList). */
export async function fetchPriceList(accountId: string, list: EtcListKey, deps: EtcClientDeps = {}): Promise<EtcResult<unknown>> {
  const r = await etcFetch("v0", listPath(accountId, `price-list/${encodeURIComponent(list)}`), deps);
  return r.ok ? r : { ...r, message: `${ETC_LIST_LABEL[list]}: ${r.message}` };
}

/** v0 parts changed since `date` (YYYY-MM-DD) — a bare `PriceListPart[]`. */
export async function fetchPriceUpdates(accountId: string, list: EtcListKey, date: string, deps: EtcClientDeps = {}): Promise<EtcResult<unknown>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, status: 0, message: "Bad price-updates date" };
  const r = await etcFetch("v0", listPath(accountId, `price-updates/${date}/${encodeURIComponent(list)}`), deps);
  return r.ok ? r : { ...r, message: `${ETC_LIST_LABEL[list]}: ${r.message}` };
}

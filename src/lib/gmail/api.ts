import { GMAIL_API_BASE } from "./config";
import { accessTokenFor } from "./connections";

/**
 * Thin Gmail API v1 client (plain fetch, bearer auth). Every call takes the
 * mailboxKey and resolves a fresh access token via connections.accessTokenFor.
 * Only the handful of endpoints the bridge needs are wrapped.
 */

async function gapi<T>(
  mailboxKey: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = await accessTokenFor(mailboxKey);
  if (!token) throw new Error("Mailbox not connected: " + mailboxKey);
  const res = await fetch(GMAIL_API_BASE + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(
      "Gmail API " + path + " → " + res.status + " " + (await res.text())
    );
  }
  return (await res.json()) as T;
}

/** Send a raw RFC-2822 message (base64url). Returns the created message +
 *  thread id; Gmail files a copy in the account's "Sent" automatically (C4). */
export async function sendRaw(
  mailboxKey: string,
  rawBase64Url: string,
  threadId?: string
): Promise<{ id: string; threadId: string }> {
  const body: Record<string, unknown> = { raw: rawBase64Url };
  if (threadId) body.threadId = threadId;
  return gapi(mailboxKey, "/messages/send", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type GmailMessageMeta = { id: string; threadId: string };

/** List message ids matching a Gmail search query (e.g. "newer_than:90d"). */
export async function listMessageIds(
  mailboxKey: string,
  query: string,
  pageToken?: string,
  maxResults = 100
): Promise<{ messages: GmailMessageMeta[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  if (pageToken) params.set("pageToken", pageToken);
  const r = await gapi<{
    messages?: GmailMessageMeta[];
    nextPageToken?: string;
  }>(mailboxKey, "/messages?" + params.toString());
  return { messages: r.messages || [], nextPageToken: r.nextPageToken };
}

/** Add/remove labels on a whole thread (two-way archive, D74: INBOX on/off).
 *  Requires the gmail.modify scope — callers must check the connection's
 *  stored grant first. */
export async function modifyThread(
  mailboxKey: string,
  threadId: string,
  change: { addLabelIds?: string[]; removeLabelIds?: string[] }
): Promise<void> {
  await gapi(mailboxKey, "/threads/" + threadId + "/modify", {
    method: "POST",
    body: JSON.stringify(change),
  });
}

export type GmailThreadMeta = { id: string };

/** List thread ids matching a Gmail search query (e.g. "in:inbox"). Ids only —
 *  the inbox reconcile (PUNCHLIST #1) builds membership sets from this and
 *  never full-fetches. */
export async function listThreadIds(
  mailboxKey: string,
  query: string,
  pageToken?: string,
  maxResults = 500
): Promise<{ threads: GmailThreadMeta[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  if (pageToken) params.set("pageToken", pageToken);
  const r = await gapi<{
    threads?: GmailThreadMeta[];
    nextPageToken?: string;
  }>(mailboxKey, "/threads?" + params.toString());
  return { threads: r.threads || [], nextPageToken: r.nextPageToken };
}

export type GmailHeader = { name: string; value: string };
export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};
export type GmailFullMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string; // epoch-ms as string
  payload?: GmailPart & { headers?: GmailHeader[] };
  snippet?: string;
};

/** Fetch a full message (headers + body). */
export async function getMessage(
  mailboxKey: string,
  id: string
): Promise<GmailFullMessage> {
  return gapi(mailboxKey, "/messages/" + id + "?format=full");
}

/** The mailbox profile — carries the current historyId (sync cursor baseline). */
export async function getProfile(
  mailboxKey: string
): Promise<{ emailAddress: string; historyId: string; messagesTotal: number }> {
  return gapi(mailboxKey, "/profile");
}

export type GmailHistoryMessageAdded = { message: GmailMessageMeta };
export type GmailHistoryRecord = { messagesAdded?: GmailHistoryMessageAdded[] };

/** Incremental changes since a historyId. Returns added-message ids + the new
 *  cursor. If the cursor is too old Gmail 404s; the caller falls back to a
 *  bounded query re-scan. */
export async function listHistory(
  mailboxKey: string,
  startHistoryId: string,
  pageToken?: string
): Promise<{ added: GmailMessageMeta[]; historyId?: string; nextPageToken?: string }> {
  const params = new URLSearchParams({
    startHistoryId,
    historyTypes: "messageAdded",
  });
  if (pageToken) params.set("pageToken", pageToken);
  const r = await gapi<{
    history?: GmailHistoryRecord[];
    historyId?: string;
    nextPageToken?: string;
  }>(mailboxKey, "/history?" + params.toString());
  const added: GmailMessageMeta[] = [];
  for (const h of r.history || []) {
    for (const m of h.messagesAdded || []) added.push(m.message);
  }
  return { added, historyId: r.historyId, nextPageToken: r.nextPageToken };
}

import type { GmailFullMessage, GmailHeader, GmailPart } from "./api";

/**
 * Minimal RFC-2822 build/parse for the Gmail bridge. We send plain-text
 * messages (the app composes plain bodies) and read the plain-text part of
 * inbound mail. No MIME library — a curtain-and-rigging back-office never
 * needs rich HTML composition, and this keeps the dependency surface at zero.
 */

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC-2047 encode a header value if it contains non-ASCII. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return "=?UTF-8?B?" + Buffer.from(value, "utf8").toString("base64") + "?=";
}

export type OutboundAttachment = {
  name: string;
  mime: string;
  /** Raw base64 payload (NOT base64url, NOT a data-URL). */
  dataBase64: string;
};

export type OutboundMime = {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  /** Real file parts (IDEAS #36) — presence switches to multipart/mixed. */
  attachments?: OutboundAttachment[];
  /** Message-ID of the message being replied to (for threading headers). */
  inReplyTo?: string;
  references?: string;
};

/** RFC-2045 wants base64 bodies wrapped at ≤76 chars per line. */
function wrap76(b64: string): string {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

/** Build a base64url-encoded RFC-2822 message ready for messages.send.
 *  Plain text by default; multipart/mixed when attachments are present. */
export function buildRaw(m: OutboundMime): string {
  const headers: string[] = [
    "From: " + m.from,
    "To: " + m.to,
  ];
  if (m.cc) headers.push("Cc: " + m.cc);
  headers.push("Subject: " + encodeHeader(m.subject));
  headers.push("MIME-Version: 1.0");
  if (m.inReplyTo) headers.push("In-Reply-To: " + m.inReplyTo);
  if (m.references) headers.push("References: " + m.references);

  const atts = m.attachments || [];
  let raw: string;
  if (!atts.length) {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push("Content-Transfer-Encoding: 8bit");
    raw = headers.join("\r\n") + "\r\n\r\n" + (m.body || "");
  } else {
    const boundary =
      "=_peak_" + Buffer.from(m.subject || "mail").toString("hex").slice(0, 18);
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    const parts: string[] = [
      `--${boundary}\r\n` +
        'Content-Type: text/plain; charset="UTF-8"\r\n' +
        "Content-Transfer-Encoding: 8bit\r\n\r\n" +
        (m.body || ""),
    ];
    for (const a of atts) {
      const name = encodeHeader((a.name || "attachment").replace(/"/g, "'"));
      parts.push(
        `--${boundary}\r\n` +
          `Content-Type: ${a.mime || "application/octet-stream"}; name="${name}"\r\n` +
          "Content-Transfer-Encoding: base64\r\n" +
          `Content-Disposition: attachment; filename="${name}"\r\n\r\n` +
          wrap76(a.dataBase64)
      );
    }
    raw =
      headers.join("\r\n") +
      "\r\n\r\n" +
      parts.join("\r\n\r\n") +
      `\r\n--${boundary}--\r\n`;
  }
  return base64url(Buffer.from(raw, "utf8"));
}

/* ---- parsing inbound ---- */

function header(headers: GmailHeader[] | undefined, name: string): string {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}

function decodePart(data?: string): string {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** Depth-first find the first text/plain body; fall back to stripped html. */
function extractBody(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decodePart(part.body.data);
  if (part.parts) {
    for (const p of part.parts) {
      const b = extractBody(p);
      if (b) return b;
    }
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodePart(part.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+\n/g, "\n")
      .trim();
  }
  return "";
}

/** Parse just the "Name <email>" display + address out of a From/To header. */
export function parseAddress(raw: string): { name: string; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw || "");
  if (m) return { name: (m[1] || "").trim(), email: m[2].trim().toLowerCase() };
  const email = (raw || "").trim().toLowerCase();
  return { name: "", email };
}

export type ParsedInbound = {
  gmailId: string;
  gmailThreadId: string;
  messageId: string; // RFC Message-ID header
  from: { name: string; email: string };
  to: string;
  subject: string;
  body: string;
  at: number; // epoch-ms
  isOutbound: boolean; // labelled SENT (message the account itself sent)
};

/** Map a full Gmail message into the shape the bridge records into comms. */
export function parseInbound(msg: GmailFullMessage): ParsedInbound {
  const hs = msg.payload?.headers;
  const at = msg.internalDate ? Number(msg.internalDate) : Date.now();
  return {
    gmailId: msg.id,
    gmailThreadId: msg.threadId,
    messageId: header(hs, "Message-ID"),
    from: parseAddress(header(hs, "From")),
    to: header(hs, "To"),
    subject: header(hs, "Subject") || "(no subject)",
    body: extractBody(msg.payload) || msg.snippet || "",
    at,
    isOutbound: (msg.labelIds || []).includes("SENT"),
  };
}

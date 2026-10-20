/* #348 slice 4 — the one cap on attachments listed per message. A neutral, import-free module so the Gmail parser
   (server) and the vendor rules (browser-safe) share it without importing each other. */
export const ATTACHMENTS_PER_MESSAGE_MAX = 20;

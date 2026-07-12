import crypto from "node:crypto";

/**
 * At-rest encryption for OAuth refresh/access tokens stored in the
 * gmail_connections table. AES-256-GCM with a key derived from AUTH_SECRET
 * (already required in every environment) via SHA-256 — so no extra secret to
 * manage. Format: base64(iv).base64(authTag).base64(ciphertext).
 *
 * If AUTH_SECRET is missing we throw: the Gmail gate also requires Google
 * creds, and a real deployment always has AUTH_SECRET, so this only fires in
 * a misconfigured setup — better loud than silently storing plaintext tokens.
 */

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is required to encrypt Gmail tokens (set it in the environment)."
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptToken(blob: string): string {
  const [ivB64, tagB64, dataB64] = (blob || "").split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted token.");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

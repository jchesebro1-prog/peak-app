import crypto from "node:crypto";

/**
 * At-rest encryption for OAuth refresh/access tokens stored in the
 * gmail_connections table, and (spec 2026-09-21-native-auth-handoff) the
 * short-lived native sign-in hand-off code. AES-256-GCM with a key derived
 * from the given secret via SHA-256. Format:
 * base64(iv).base64(authTag).base64(ciphertext).
 *
 * encryptToken/decryptToken keep the original AUTH_SECRET-bound behaviour;
 * encryptWith/decryptWith take the secret explicitly so pure code (and its
 * tests) never touch process.env. If AUTH_SECRET is missing we throw: a real
 * deployment always has it, so this only fires in a misconfigured setup —
 * better loud than silently storing plaintext tokens.
 */

function keyFor(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is required to encrypt Gmail tokens (set it in the environment)."
    );
  }
  return secret;
}

export function encryptWith(plain: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptWith(blob: string, secret: string): string {
  const [ivB64, tagB64, dataB64] = (blob || "").split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted token.");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    keyFor(secret),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

export function encryptToken(plain: string): string {
  return encryptWith(plain, authSecret());
}

export function decryptToken(blob: string): string {
  return decryptWith(blob, authSecret());
}

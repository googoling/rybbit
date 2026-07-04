import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Encrypt the Mailbo API key at rest (AES-256-GCM). Key is derived from a server
// secret so a DB dump alone can't reveal the key. Override with MAILBO_ENC_KEY;
// otherwise falls back to BETTER_AUTH_SECRET so it works without new config.
const PREFIX = "enc:v1:";

function encKey(): Buffer {
  const secret = process.env.MAILBO_ENC_KEY || process.env.BETTER_AUTH_SECRET || "";
  if (!secret) throw new Error("No MAILBO_ENC_KEY or BETTER_AUTH_SECRET set for Mailbo key encryption");
  return createHash("sha256").update(secret).digest();
}

export function isEncrypted(value: string): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decrypt(value: string): string {
  if (!isEncrypted(value)) return value; // legacy plaintext — return as-is
  const [ivB64, tagB64, ctB64] = value.slice(PREFIX.length).split(":");
  const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

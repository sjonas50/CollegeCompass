import { createHash, randomBytes } from "node:crypto";

/** A URL-safe random token with 256 bits of entropy. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored only as SHA-256 hashes so a database leak can't be replayed as sessions or links. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

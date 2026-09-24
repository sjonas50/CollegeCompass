import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { env } from "@/env";

/** Best-effort client IP for rate limiting (set by Vercel and most proxies). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/**
 * The caller's IP address as a keyed hash that changes daily, for rate-limit keys, so raw
 * addresses are never stored. Uses CRON_SECRET (required in production) as the key.
 */
export async function clientIpKey(now = new Date()): Promise<string> {
  const day = now.toISOString().slice(0, 10);
  const secret = env().CRON_SECRET ?? "college-compass-dev-rate-key";
  return createHmac("sha256", secret).update(`${day}\n${await clientIp()}`).digest("base64url");
}

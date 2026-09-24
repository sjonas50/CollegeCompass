import { timingSafeEqual } from "node:crypto";
import { env } from "@/env";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Open in development without a secret. */
export function isAuthorizedCron(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

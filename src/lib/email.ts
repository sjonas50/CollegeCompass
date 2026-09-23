import "server-only";
import { env } from "@/env";

export type Email = { to: string; subject: string; text: string };

/**
 * Sends transactional email. Only the development "log" transport exists so far; env()
 * refuses it in production until a provider is configured.
 */
export async function sendEmail(email: Email) {
  switch (env().EMAIL_TRANSPORT) {
    case "log":
      console.info(`[email] to=${email.to} subject="${email.subject}"\n${email.text}`);
      return;
  }
}

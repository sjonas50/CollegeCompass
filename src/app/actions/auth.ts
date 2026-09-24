"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { getDb } from "@/db";
import { env } from "@/env";
import {
  LoginSchema,
  ParentSignupSchema,
  StudentSignupSchema,
  authenticate,
  registerParent,
  registerStudent,
} from "@/lib/accounts";
import { isPlausibleStudentBirthDate, isUnder13 } from "@/lib/auth/age";
import {
  clearSessionCookie,
  hasUnder13Gate,
  readSessionToken,
  setSessionCookie,
  setUnder13Gate,
} from "@/lib/auth/cookies";
import { homePathFor } from "@/lib/auth/dal";
import { createSession, invalidateSession, validateSession } from "@/lib/auth/sessions";
import { hashToken } from "@/lib/auth/tokens";
import { createConsentRequest } from "@/lib/consent/requests";
import { sendEmail } from "@/lib/email";
import { type FormState, birthDateFromForm, fieldErrors, safeNext } from "@/lib/forms";
import { consumeRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";

const MINUTE = 60_000;

export type AgeGateState = { step: "teen"; birthDate: string } | { step: "child" } | FormState;

/** Step 1 of student signup. The question is neutral; the answer decides which form comes next. */
export async function checkAgeAction(_prev: AgeGateState, formData: FormData): Promise<AgeGateState> {
  if (await hasUnder13Gate()) return { step: "child" };
  const birthDate = birthDateFromForm(formData);
  if (!isPlausibleStudentBirthDate(birthDate)) {
    return { errors: { birthDate: ["Enter your real birthday."] } };
  }
  if (isUnder13(birthDate)) {
    await setUnder13Gate();
    return { step: "child" };
  }
  return { step: "teen", birthDate };
}

export async function registerStudentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (await hasUnder13Gate()) return { message: "Please ask a parent to set up your account." };
  const parsed = StudentSignupSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
    birthDate: formData.get("birthDate"),
    grade: formData.get("grade"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const db = await getDb();
  if (!(await consumeRateLimit(db, `signup:ip:${await clientIp()}`, 10, 60 * MINUTE))) {
    return { message: "Too many attempts. Please try again later." };
  }
  const result = await registerStudent(db, parsed.data);
  if (!result.ok) {
    if (result.error === "invalid_grade") return { errors: { grade: ["Choose your grade from the list."] } };
    if (result.error === "under_13") {
      await setUnder13Gate();
      return { message: "Please ask a parent to set up your account." };
    }
    return { errors: { email: ["An account with this email already exists."] } };
  }
  const { token } = await createSession(db, result.value.userId);
  await setSessionCookie(token);
  redirect("/dashboard");
}

export type ParentRequestState = { sent: true } | FormState;

/** An under-13 student gives us a parent's email; nothing else about the child is collected. */
export async function requestParentConsentAction(
  _prev: ParentRequestState,
  formData: FormData,
): Promise<ParentRequestState> {
  const parsed = z.object({ parentEmail: z.email("Enter a valid email address.").trim().toLowerCase() })
    .safeParse({ parentEmail: formData.get("parentEmail") });
  if (!parsed.success) return fieldErrors(parsed.error);

  const db = await getDb();
  const { parentEmail } = parsed.data;
  const underLimit =
    (await consumeRateLimit(db, `consent:email:${hashToken(parentEmail)}`, 3, 24 * 60 * MINUTE)) &&
    (await consumeRateLimit(db, `consent:ip:${await clientIp()}`, 10, 60 * MINUTE));
  // Same response either way, so the form can't be used to probe or spam an address.
  if (underLimit) {
    const { token, expiresAt } = await createConsentRequest(db, parentEmail);
    const link = new URL(`/parent/consent/${token}`, env().APP_URL).toString();
    await sendEmail({
      to: parentEmail,
      subject: "Your child asked to join College Compass",
      text: [
        "Hello,",
        "",
        "Someone asked to set up a College Compass account and gave your email as their parent's.",
        "College Compass helps students in grades 7–12 explore careers and plan for college.",
        "",
        "Because the student is under 13, we need your permission first. Create your parent account",
        "and your child's account here:",
        link,
        "",
        `This link expires on ${expiresAt.toDateString()}. If you do nothing, we will delete your email address`,
        "and won't contact you again.",
      ].join("\n"),
    });
  }
  return { sent: true };
}

export async function registerParentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = ParentSignupSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const db = await getDb();
  if (!(await consumeRateLimit(db, `signup:ip:${await clientIp()}`, 10, 60 * MINUTE))) {
    return { message: "Too many attempts. Please try again later." };
  }
  const result = await registerParent(db, parsed.data);
  if (!result.ok) return { errors: { email: ["An account with this email already exists."] } };

  const { token } = await createSession(db, result.value.userId);
  await setSessionCookie(token);
  redirect(safeNext(formData.get("next")) ?? "/parent");
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = LoginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const db = await getDb();
  const underLimit =
    (await consumeRateLimit(db, `login:id:${hashToken(parsed.data.identifier)}`, 10, 15 * MINUTE)) &&
    (await consumeRateLimit(db, `login:ip:${await clientIp()}`, 50, 15 * MINUTE));
  if (!underLimit) return { message: "Too many sign-in attempts. Please wait 15 minutes and try again." };

  const result = await authenticate(db, parsed.data);
  if (!result) return { message: "That email/username and password don't match." };

  const { token } = await createSession(db, result.userId);
  await setSessionCookie(token);
  const session = await validateSession(db, token);
  redirect(safeNext(formData.get("next")) ?? homePathFor(session!.user));
}

export async function logoutAction() {
  const token = await readSessionToken();
  if (token) await invalidateSession(await getDb(), token);
  await clearSessionCookie();
  redirect("/");
}

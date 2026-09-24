"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { forgetSavedAssessment } from "../saved-store";

/** The results are in an account now, so the browser's copy goes; then on to `href`. */
export function ForgetAndContinue({ href, message }: { href: string; message: string }) {
  const router = useRouter();
  useEffect(() => {
    forgetSavedAssessment();
    router.replace(href);
  }, [router, href]);
  return (
    <p aria-live="polite" className="text-muted">
      {message}{" "}
      <Link href={href} className="underline underline-offset-2">
        Continue
      </Link>
    </p>
  );
}

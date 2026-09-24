"use client";

import { useEffect } from "react";
import { setDocumentLang } from "@/app/page-lang";

/**
 * Marks the whole document with the guide's language after client-side navigation (switching
 * languages, or coming from another page). A full page load already has it from the root layout.
 * Leaving the guide puts back English.
 */
export function DocumentLang({ lang }: { lang: string }) {
  useEffect(() => setDocumentLang(document.documentElement, lang), [lang]);
  return null;
}

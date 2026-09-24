import { redirect } from "next/navigation";
import { aidGuideHref } from "@/lib/aid-guide";

// The guide starts in English; every page links to the Spanish version.
export default function AidGuideRedirect() {
  redirect(aidGuideHref("en"));
}

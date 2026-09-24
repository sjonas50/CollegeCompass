import type { Metadata } from "next";
import { OnetDataAttribution, OnetToolsAttribution } from "@/components/attribution";
import { PageHeading } from "@/components/ui";
import { FreeResults } from "./free-results";

export const metadata: Metadata = {
  title: "Your quiz results",
  // Results live in the visitor's browser; there's nothing here for search engines.
  robots: { index: false },
};

/** Scored in the browser from the answers saved there; matches come from the six area scores only. */
export default function TryResultsPage() {
  return (
    <div className="space-y-8">
      <PageHeading title="Your direction, for now" />
      <FreeResults />
      <div className="space-y-1 border-t border-border pt-4">
        <OnetToolsAttribution />
        <OnetDataAttribution />
      </div>
    </div>
  );
}

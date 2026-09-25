import type { Metadata } from "next";
import { OnetDataAttribution, OnetToolsAttribution } from "@/components/attribution";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth/dal";
import { FreeResults } from "./free-results";
import { resultsViewer } from "./viewer";

export const metadata: Metadata = {
  title: "Your quiz results",
  // Results live in the visitor's browser; there's nothing here for search engines.
  robots: { index: false },
};

/**
 * Scored in the browser from the answers saved there; matches come from the six area scores only.
 * The server only decides how the viewer can keep them (a parent adds them to a child's account).
 */
export default async function TryResultsPage() {
  const viewer = await resultsViewer(await getDb(), await getCurrentUser());
  return (
    <div className="space-y-8">
      {/* The heading is there too: it depends on whether this browser holds a finished quiz. */}
      <FreeResults viewer={viewer} />
      <div className="space-y-1 border-t border-border pt-4">
        <OnetToolsAttribution />
        <OnetDataAttribution />
      </div>
    </div>
  );
}

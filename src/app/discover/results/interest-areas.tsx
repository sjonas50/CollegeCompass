import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { RIASEC, RIASEC_INFO, type Riasec } from "@/lib/assessments/instruments";
import { codeTieText, interestPattern, noAreaStandsOut, strongAreas, tiedAreasText } from "@/lib/assessments/interest-pattern";

/**
 * The six interest area scores and what they say, on both results pages. Tied areas are shown as
 * tied rather than in the code's RIASEC order. When the scores are about the same, or no area was
 * liked, the card says no area stands out, followed by `whenNoLead` (what the student can do next).
 */
export function InterestAreasCard({ areas, whenNoLead }: { areas: Record<Riasec, number>; whenNoLead: ReactNode }) {
  const pattern = interestPattern(areas);
  const strong = strongAreas(pattern);
  const noLead = noAreaStandsOut(pattern);
  return (
    <Card>
      <h2 className="font-medium">Your interest areas</h2>
      {noLead ? (
        <div className="mt-1 space-y-3 text-sm text-muted">
          <p>
            {pattern.kind === "flat"
              ? "No area stands out. You rated all six about the same, which can happen when you're not sure yet."
              : "No area stands out. Overall you leaned toward disliking all six, which can happen when you haven't tried many of these activities yet."}
          </p>
          {whenNoLead}
        </div>
      ) : pattern.kind === "tied" ? (
        <p className="mt-1 text-sm text-muted">{tiedAreasText(pattern)}</p>
      ) : (
        <p className="mt-1 text-sm text-muted">
          Your code is <strong className="text-foreground">{pattern.code}</strong>: {strong.map((a) => RIASEC_INFO[a].name).join(", ")}.
          {pattern.ties.length > 0 && <> {codeTieText(pattern)}</>}
        </p>
      )}
      <ul className="mt-4 space-y-3">
        {RIASEC.map((area) => (
          <li key={area}>
            <div className="flex justify-between text-sm">
              <span className={strong.includes(area) ? "font-medium" : ""}>
                {RIASEC_INFO[area].name} <span className="text-muted">· {RIASEC_INFO[area].short}</span>
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-border" aria-hidden>
              <div
                className={`h-2 rounded-full ${strong.includes(area) ? "bg-accent" : "bg-muted"}`}
                style={{ width: `${Math.max(4, (areas[area] / 40) * 100)}%` }}
              />
            </div>
            {/* With no area ahead, each one is worth reading about. */}
            {(noLead || strong.includes(area)) && <p className="mt-1 text-sm text-muted">{RIASEC_INFO[area].description}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

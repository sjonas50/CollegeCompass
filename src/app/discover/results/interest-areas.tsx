import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { RIASEC, RIASEC_INFO, type Riasec } from "@/lib/assessments/instruments";
import { codeTieText, interestPattern, strongAreas, tiedAreasText } from "@/lib/assessments/interest-pattern";

/**
 * The six interest area scores and what they say, on both results pages. Tied areas are shown as
 * tied rather than in the code's RIASEC order, and when the scores are about the same the card
 * says no area stands out, followed by `whenFlat` (what the student can do next).
 */
export function InterestAreasCard({ areas, whenFlat }: { areas: Record<Riasec, number>; whenFlat: ReactNode }) {
  const pattern = interestPattern(areas);
  const strong = strongAreas(pattern);
  const flat = pattern.kind === "flat";
  return (
    <Card>
      <h2 className="font-medium">Your interest areas</h2>
      {pattern.kind === "flat" ? (
        <div className="mt-1 space-y-3 text-sm text-muted">
          <p>No area stands out. You rated all six about the same, which can happen when you&apos;re not sure yet.</p>
          {whenFlat}
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
            {(flat || strong.includes(area)) && <p className="mt-1 text-sm text-muted">{RIASEC_INFO[area].description}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

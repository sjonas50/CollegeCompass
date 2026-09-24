"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { importSavedResultsAction } from "@/app/actions/try";
import { forgetSavedAssessment, useSavedAssessment } from "@/app/try/saved-store";
import { Button, Card, FormMessage } from "@/components/ui";
import {
  SAVED_ASSESSMENT_FIELD,
  type SavedAssessment,
  isFinished,
  serializeSavedAssessment,
} from "@/lib/assessments/anonymous";
import { RIASEC_INFO, type Riasec } from "@/lib/assessments/instruments";
import { scoreInterests } from "@/lib/assessments/scoring";

/**
 * Offers to bring a free quiz finished in this browser (at /try) into the signed-in student's
 * account. Renders nothing unless the browser holds a finished quiz. The dashboard shows it only
 * while the student hasn't finished the interests activity; the server refuses a second import.
 *
 * `startedInterests`: the student has an unfinished interests activity, which these answers replace.
 */
export function SavedResultsImport({ startedInterests = false }: { startedInterests?: boolean }) {
  const saved = useSavedAssessment();
  if (!isFinished(saved)) return null;
  return <ImportCard saved={saved} startedInterests={startedInterests} />;
}

function ImportCard({ saved, startedInterests }: { saved: SavedAssessment; startedInterests: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const top = scoreInterests(saved.answers).code.split("") as Riasec[];

  function add() {
    setError(undefined);
    startTransition(async () => {
      const res = await importSavedResultsAction(serializeSavedAssessment(saved));
      if (!res.ok) return setError(res.message);
      forgetSavedAssessment();
      router.push("/discover/results");
    });
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-medium">Add your quiz results?</h2>
      <p className="text-sm text-muted">
        Someone took the free interest quiz on this device. The top interests were{" "}
        {top.map((l) => RIASEC_INFO[l].name.toLowerCase()).join(", ")}. If that was you, add the results to your account to
        see your career matches.
      </p>
      {startedInterests && (
        <p className="text-sm text-muted">These answers will take the place of the interests activity you started here.</p>
      )}
      <FormMessage message={error} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={add} disabled={pending}>
          {pending ? "Adding…" : "Add my results"}
        </Button>
        <Button variant="secondary" onClick={forgetSavedAssessment} disabled={pending}>
          Not mine, remove them
        </Button>
      </div>
    </Card>
  );
}

/**
 * For account-creation forms: sends a free quiz finished in this browser with the form, in the
 * `savedAssessment` field, while the box is ticked. Renders nothing when there's no finished quiz.
 * Only the answers are sent; the server checks them strictly and scores them itself.
 */
export function SavedQuizField({
  label = "Add the interest quiz results saved on this device to my account",
  defaultChecked = true,
}: {
  label?: string;
  defaultChecked?: boolean;
}) {
  const saved = useSavedAssessment();
  const [include, setInclude] = useState(defaultChecked);
  if (!isFinished(saved)) return null;
  return (
    <div className="rounded-lg border border-border p-4 text-sm">
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} className="mt-1 size-4" />
        <span>{label}</span>
      </label>
      {include && <input type="hidden" name={SAVED_ASSESSMENT_FIELD} value={serializeSavedAssessment(saved)} />}
    </div>
  );
}

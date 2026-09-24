import { setMyGradeAction, setMyRemindersAction } from "@/app/actions/settings";
import { Button, gradeOptionLabel } from "@/components/ui";
import { gradeQuestion } from "@/lib/auth/age";

/**
 * A grade select for settings. Graduates see "Finished high school" selected, which saves as
 * "no change", so saving other settings never moves them back to 12th grade.
 */
export function GradeSettingSelect({ id, grade }: { id: string; grade: number | null }) {
  const q = gradeQuestion();
  const graduated = grade !== null && grade > 12;
  return (
    <select
      id={id}
      name="grade"
      defaultValue={graduated || grade === null ? "" : String(grade)}
      className="mt-1 block min-h-11 rounded-lg border border-border bg-surface px-3"
    >
      {graduated && <option value="">Finished high school</option>}
      {Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i).map((g) => (
        <option key={g} value={g}>
          {gradeOptionLabel(g)}
        </option>
      ))}
    </select>
  );
}

/** Small settings panel for the student dashboard: grade correction and reminder emails. */
export function StudentSettings({
  grade,
  remindersEnabled,
  remindersGoToParent,
}: {
  grade: number | null;
  remindersEnabled: boolean;
  remindersGoToParent: boolean;
}) {
  const q = gradeQuestion();
  return (
    <details className="rounded-xl border border-border bg-surface p-4">
      <summary className="min-h-11 cursor-pointer content-center font-medium">Settings</summary>
      <div className="mt-4 space-y-5">
        <form action={setMyGradeAction} className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="settings-grade" className="block text-sm font-medium">
              {q.label}
            </label>
            <p className="text-sm text-muted">It moves up automatically each August. Fix it here if it&apos;s wrong.</p>
            <GradeSettingSelect id="settings-grade" grade={grade} />
          </div>
          <Button type="submit" variant="secondary">Save grade</Button>
        </form>
        {remindersGoToParent ? (
          <p className="text-sm text-muted">
            Weekly reminder emails about your steps go to your parent or guardian. They can change this on their parent page.
          </p>
        ) : (
          <form action={setMyRemindersAction} className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={remindersEnabled} className="size-4" />
              Send me a weekly reminder email with my steps
            </label>
            <Button type="submit" variant="secondary">Save</Button>
          </form>
        )}
      </div>
    </details>
  );
}

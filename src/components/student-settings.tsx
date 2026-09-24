import { setMyGradeAction, setMyRemindersAction } from "@/app/actions/settings";
import { Button, gradeOptionLabel } from "@/components/ui";
import { MAX_GRADE, gradeQuestion, schoolYearOf } from "@/lib/auth/age";
import type { ReminderSetting } from "@/lib/reminders";

function keepLabel(grade: number | null) {
  if (grade === null) return "Not set";
  return grade > MAX_GRADE ? "Finished high school" : gradeOptionLabel(grade);
}

/**
 * The grade select for a settings form, plus a hidden `shownGrade` with the grade it shows. It never
 * shows or submits a grade the student didn't choose: when the current grade isn't an option (a
 * graduate, a senior who just finished 12th in June or July, or no grade yet) it adds a selected
 * "keep as is" option with value "". The grade actions ignore "" and a value equal to `shownGrade`,
 * so saving the form untouched, even from a page loaded before grades advance in August, does nothing.
 */
export function GradeSettingSelect({ id, grade }: { id: string; grade: number | null }) {
  const q = gradeQuestion();
  const grades = Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i);
  const offered = grade !== null && grades.includes(grade);
  const keep = offered ? null : <option value="">{keepLabel(grade)}</option>;
  return (
    <>
      <input type="hidden" name="shownGrade" value={grade ?? ""} />
      <input type="hidden" name="gradeYear" value={schoolYearOf()} />
      <select
        id={id}
        name="grade"
        defaultValue={offered ? String(grade) : ""}
        className="mt-1 block min-h-11 rounded-lg border border-border bg-surface px-3"
      >
        {(grade === null || grade < q.min) && keep}
        {grades.map((g) => (
          <option key={g} value={g}>
            {gradeOptionLabel(g)}
          </option>
        ))}
        {grade !== null && grade > q.max && keep}
      </select>
    </>
  );
}

/** Small settings panel for the student dashboard: grade correction and reminder emails. */
export function StudentSettings({ grade, reminders }: { grade: number | null; reminders: ReminderSetting }) {
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
        {reminders.kind === "self" ? (
          <form action={setMyRemindersAction} className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={reminders.enabled} className="size-4" />
              {grade !== null && grade > MAX_GRADE
                ? "Email me when applications on my list are due soon"
                : "Send me a weekly reminder email with my steps"}
            </label>
            <Button type="submit" variant="secondary">Save</Button>
          </form>
        ) : (
          <p className="text-sm text-muted">
            {reminders.kind === "none"
              ? "Weekly reminder emails aren't available for your account because it doesn't have an email address."
              : reminders.enabled
                ? "Weekly reminder emails about your steps go to your parent or guardian. They can change this on their parent page."
                : "Your parent or guardian has turned off weekly reminder emails about your steps. They can turn them back on from their parent page."}
          </p>
        )}
      </div>
    </details>
  );
}

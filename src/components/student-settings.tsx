import { setMyGradeAction, setMyRemindersAction } from "@/app/actions/settings";
import { Button } from "@/components/ui";

/** Small settings panel for the student dashboard: grade correction and reminder emails. */
export function StudentSettings({ grade, remindersEnabled }: { grade: number | null; remindersEnabled: boolean }) {
  return (
    <details className="rounded-xl border border-border bg-surface p-4">
      <summary className="cursor-pointer font-medium">Settings</summary>
      <div className="mt-4 space-y-5">
        <form action={setMyGradeAction} className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="settings-grade" className="block text-sm font-medium">
              Your grade this school year
            </label>
            <p className="text-sm text-muted">It moves up automatically each August. Fix it here if it&apos;s wrong.</p>
            <select
              id="settings-grade"
              name="grade"
              defaultValue={grade && grade <= 12 ? grade : 12}
              className="mt-1 block min-h-11 rounded-lg border border-border bg-surface px-3"
            >
              {[7, 8, 9, 10, 11, 12].map((g) => (
                <option key={g} value={g}>
                  {g}th grade
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="secondary">Save grade</Button>
        </form>
        <form action={setMyRemindersAction} className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={remindersEnabled} className="size-4" />
            Send me a weekly reminder email with my steps
          </label>
          <Button type="submit" variant="secondary">Save</Button>
        </form>
      </div>
    </details>
  );
}

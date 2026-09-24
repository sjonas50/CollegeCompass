"use client";

import { useState, useTransition } from "react";
import { type ActionResult, addMilestoneStepAction, markMilestoneAction } from "@/app/actions/roadmap";
import { Button } from "@/components/ui";
import { announce, focusById } from "./announcer";

export type WeekState = "can_add" | "added" | "full";

/**
 * Done / Not for me / Add to this week for an open milestone, or Undo for one that's done or
 * set aside. `focusAfter` is where focus goes once the card moves to another section.
 */
export function MilestoneActions({
  id,
  title,
  status,
  week,
  focusAfter,
}: {
  id: string;
  title: string;
  status: "open" | "done" | "skipped";
  week: WeekState;
  focusAfter: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function run(action: () => Promise<ActionResult>, success: string, focusTarget: string) {
    setError(undefined);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setError(res.message);
        return;
      }
      announce(success);
      focusById(focusTarget);
    });
  }

  const forTitle = <span className="sr-only">: {title}</span>;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {status === "open" ? (
          <>
            <Button
              type="button"
              disabled={pending}
              onClick={() => run(() => markMilestoneAction(id, "done"), `Nice work! “${title}” is done.`, focusAfter)}
            >
              Done{forTitle}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(() => markMilestoneAction(id, "skipped"), `Set aside “${title}”. You can bring it back anytime.`, focusAfter)
              }
            >
              Not for me{forTitle}
            </Button>
            {week === "added" ? (
              <span className="inline-flex min-h-11 items-center px-1 text-sm text-muted">
                <span aria-hidden className="mr-1">✓</span> On this week&apos;s list
              </span>
            ) : (
              <Button
                type="button"
                variant="secondary"
                disabled={pending || week === "full"}
                aria-describedby={week === "full" ? "week-full-note" : undefined}
                onClick={() => run(() => addMilestoneStepAction(id), `Added “${title}” to this week.`, `m-${id}`)}
              >
                Add to this week{forTitle}
              </Button>
            )}
          </>
        ) : (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => markMilestoneAction(id, null), `Moved “${title}” back to your roadmap.`, focusAfter)}
          >
            Undo{forTitle}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

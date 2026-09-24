"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { type AddCollegeState, addCollegeAction } from "@/app/actions/applications";
import { Button } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";

const linkClass = "inline-flex min-h-11 items-center underline underline-offset-2";

/**
 * The student's side of <AddToListButton>: adds the college, then says so in the status line and
 * moves focus to the link that replaces the button ("See my list", or "Go to my list" when the list
 * filled up in the meantime), so keyboard and screen reader users aren't left on a button that's gone.
 */
export function AddToListForm({
  unitId,
  name,
  listed,
  full,
}: {
  unitId: number;
  name: string;
  listed: boolean;
  full: boolean;
}) {
  const [state, action, pending] = useFormAction<AddCollegeState>(addCollegeAction, { status: "idle" });
  const linkRef = useRef<HTMLAnchorElement>(null);
  const fullLinkRef = useRef<HTMLAnchorElement>(null);
  const onList = listed || state.status === "added" || state.status === "already";
  // The list filled up (in another tab, say) after this page loaded.
  const becameFull = !onList && state.status === "limit";

  useEffect(() => {
    if (state.status === "added" || state.status === "already") linkRef.current?.focus();
    else if (state.status === "limit") fullLinkRef.current?.focus();
  }, [state]);

  const announcement = state.status === "added" || state.status === "already" || state.status === "limit" ? (state.message ?? "") : "";

  return (
    <div className="space-y-1">
      {/* Always rendered, so screen readers announce the message when it changes. */}
      <p role="status" className={`text-sm ${becameFull ? "" : "text-muted"}`}>
        {announcement}
      </p>
      {onList ? (
        <p className="flex flex-wrap items-center gap-x-3">
          <span className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-success-soft px-3 font-medium">
            <span aria-hidden>✓</span> On your list
          </span>
          <Link ref={linkRef} href="/applications" className={linkClass}>
            See my list
          </Link>
        </p>
      ) : full || becameFull ? (
        <p className="text-sm">
          {/* After a failed add, the status line above says the list is full. */}
          {!becameFull && <>Your list is full. Remove a college or program you&apos;re less sure about to add this one. </>}
          <Link ref={fullLinkRef} href="/applications" className={linkClass}>
            Go to my list
          </Link>
        </p>
      ) : (
        <form action={action}>
          <input type="hidden" name="unitId" value={unitId} />
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending ? "Adding…" : "Add to my list"}
            <span className="sr-only">: {name}</span>
          </Button>
        </form>
      )}
      {state.status === "not_found" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
    </div>
  );
}

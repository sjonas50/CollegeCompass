"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { type AddCollegeState, addCollegeAction } from "@/app/actions/applications";
import { Button } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";

const linkClass = "inline-flex min-h-11 items-center underline underline-offset-2";

/**
 * The student's side of <AddToListButton>: adds the college, then says so and moves focus to the
 * "See my list" link (the button it replaces is gone).
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
  const onList = listed || state.status === "added" || state.status === "already";

  useEffect(() => {
    if (state.status === "added" || state.status === "already") linkRef.current?.focus();
  }, [state]);

  return (
    <div className="space-y-1">
      {onList ? (
        <p className="flex flex-wrap items-center gap-x-3">
          <span className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-success-soft px-3 font-medium">
            <span aria-hidden>✓</span> On your list
          </span>
          <Link ref={linkRef} href="/applications" className={linkClass}>
            See my list
          </Link>
        </p>
      ) : full || state.status === "limit" ? (
        <p className="text-sm">
          Your list is full. Remove a college or program you&apos;re less sure about to add this one.{" "}
          <Link href="/applications" className={linkClass}>
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
      <p role="status" className="text-sm text-muted">
        {state.status === "added" || state.status === "already" ? state.message : ""}
      </p>
      {state.status === "not_found" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
    </div>
  );
}

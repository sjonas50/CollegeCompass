"use client";

import { useFormStatus } from "react-dom";
import { updateMatchesAction } from "@/app/actions/discover";
import { Button } from "@/components/ui";

/** "Update my matches": remakes matches made before the student's strengths counted. */
export function UpdateMatchesButton({ variant = "primary" }: { variant?: "primary" | "secondary" }) {
  return (
    <form action={updateMatchesAction}>
      <UpdateButton variant={variant} />
    </form>
  );
}

function UpdateButton({ variant }: { variant: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? "Updating…" : "Update my matches"}
    </Button>
  );
}

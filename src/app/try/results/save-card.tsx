"use client";

import Link from "next/link";
import { Button, ButtonLink, Card } from "@/components/ui";

/**
 * Who is looking at the free quiz's results, which decides how they can keep them. Someone already
 * signed in is never sent to student signup: it would replace their session with a new account.
 */
export type ResultsViewer = "visitor" | "parent" | "student" | "student_with_results" | "other";

export function SaveResultsCard({ viewer, onTakeAgain }: { viewer: ResultsViewer; onTakeAgain?: () => void }) {
  const takeAgain = (
    <Button variant="secondary" onClick={onTakeAgain}>
      Take it again
    </Button>
  );

  if (viewer === "parent") {
    return (
      <Card className="space-y-4">
        <h2 className="font-medium">Save these for your child</h2>
        <p className="text-sm text-muted">
          You&apos;re signed in as a parent. If your child took the quiz, you can add these results when you set up
          their account. Tick the box about the free quiz at the bottom of the form.
        </p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/parent/children/new">Add a child</ButtonLink>
          {takeAgain}
        </div>
        <p className="text-sm text-muted">
          Does your child already have an account? They can sign in on this device and add the results from their
          dashboard.
        </p>
      </Card>
    );
  }

  if (viewer === "student") {
    return (
      <Card className="space-y-4">
        <h2 className="font-medium">Add these to your account</h2>
        <p className="text-sm text-muted">You&apos;re signed in, so you can add these results from your dashboard.</p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/dashboard">Go to my dashboard</ButtonLink>
          {takeAgain}
        </div>
      </Card>
    );
  }

  if (viewer === "student_with_results") {
    return (
      <Card className="space-y-4">
        <h2 className="font-medium">Your account already has interest results</h2>
        <p className="text-sm text-muted">
          So these can&apos;t be added. You can see your own results and career matches in your account.
        </p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/discover/results">See my results</ButtonLink>
          {takeAgain}
        </div>
      </Card>
    );
  }

  if (viewer === "other") {
    return (
      <Card className="space-y-4">
        <p className="text-sm text-muted">Only student accounts can keep quiz results, so these stay on this device.</p>
        <div className="flex flex-wrap gap-2">{takeAgain}</div>
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      <h2 className="font-medium">Save your results</h2>
      <p className="text-sm text-muted">
        Create an account to keep these results, see more careers and why they fit, and build a plan for high school and
        beyond. Your answers come with you, so you won&apos;t need to take the quiz again.
      </p>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/signup?from=quiz">Save my results</ButtonLink>
        {takeAgain}
      </div>
      <p className="text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="underline underline-offset-2">
          Sign in
        </Link>{" "}
        on this device and add them from your dashboard.
      </p>
      <p className="text-sm text-muted">
        Parent or guardian?{" "}
        <Link href="/signup/parent" className="underline underline-offset-2">
          Create a parent account
        </Link>
        , then add these results when you set up your child&apos;s account.
      </p>
    </Card>
  );
}

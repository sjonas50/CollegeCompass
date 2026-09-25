"use client";

import Link from "next/link";
import { Button, ButtonLink, Card } from "@/components/ui";

/**
 * Who is looking at the free quiz's results, which decides how they can keep them. Someone already
 * signed in is never sent to student signup: it would replace their session with a new account.
 */
export type ResultsViewer = "visitor" | "parent" | "student" | "student_with_results" | "other";

type SaveCardProps = {
  viewer: ResultsViewer;
  onTakeAgain?: () => void;
  /** The strengths add-on is finished on this device, so it goes along with the results. */
  strengths?: boolean;
  /** How long a new family's free trial lasts (TRIAL_DAYS); not mentioned when there's none. */
  trialDays?: number;
};

/** What an account adds to the free results. Every line is something the account really has. */
function accountExtras(strengths: boolean): string[] {
  return [
    "Why each career fits you, in plain words",
    strengths ? "Your strengths, saved with your results" : "Your strengths, from a 3-minute personality activity",
    "What matters to you in a job, to fine-tune your matches",
    "A grade-by-grade plan, with small steps each week",
    "An AI counselor that remembers your goals",
  ];
}

export function SaveResultsCard({ viewer, onTakeAgain, strengths = false, trialDays }: SaveCardProps) {
  const takeAgain = (
    <Button variant="secondary" onClick={onTakeAgain}>
      Take it again
    </Button>
  );
  const these = strengths ? "these results and strengths" : "these results";

  if (viewer === "parent") {
    return (
      <Card className="space-y-4">
        <h2 className="font-medium">Save these for your child</h2>
        <p className="text-sm text-muted">
          You&apos;re signed in as a parent. If your child took the quiz, you can add {these} when you set up their
          account. Tick the box about the free quiz at the bottom of the form.
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
        <p className="text-sm text-muted">You&apos;re signed in, so you can add {these} from your dashboard.</p>
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
      <h2 className="text-lg font-medium">Save your results and see more</h2>
      <p className="text-sm">Create an account to keep {these}. Your answers come with you, so you won&apos;t need to start over. You also get:</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {accountExtras(strengths).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="text-sm text-muted">
        {trialDays ? <>Try everything free for {trialDays} days, with no card needed. </> : null}
        If cost is a problem, your family can get free access.
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
        <strong className="font-medium text-foreground">Under 13?</strong> A parent or guardian sets up your account, and
        your results wait on this device until you sign in. Parents can{" "}
        <Link href="/signup/parent" className="underline underline-offset-2">
          create a parent account
        </Link>{" "}
        and add these results when they set up yours.
      </p>
    </Card>
  );
}

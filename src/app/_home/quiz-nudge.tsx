import Link from "next/link";
import { ArrowIcon } from "./icons";

/**
 * A quiet second path to the free interest quiz. The quiz may be dropped: to remove it, delete this
 * file and the one <QuizNudge /> line in src/app/page.tsx (and its check in src/app/try/try.test.ts).
 */
export function QuizNudge() {
  return (
    <Link
      href="/try"
      className="group mt-4 flex min-h-11 flex-col gap-1 rounded-xl border border-dashed border-border px-5 py-3 text-sm transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <span className="font-medium">
        Not ready to sign up? Try the free{" "}
        <span className="whitespace-nowrap">
          interest quiz
          <ArrowIcon className="ml-1.5 inline size-4 align-[-3px] text-accent motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" />
        </span>
      </span>
      <span className="text-muted">About 10 minutes, no account. Your answers stay on your device.</span>
    </Link>
  );
}

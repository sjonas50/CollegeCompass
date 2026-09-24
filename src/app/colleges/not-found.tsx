import { ButtonLink, PageHeading } from "@/components/ui";

// For a college that isn't in the latest College Scorecard data, or a mistyped link.
export default function CollegeNotFound() {
  return (
    <div className="space-y-4">
      <PageHeading
        title="We couldn't find that college"
        lead="It may not be in the latest College Scorecard data, or the link may be old."
      />
      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/colleges">Search colleges</ButtonLink>
        <ButtonLink href="/applications" variant="secondary">Go to my list</ButtonLink>
      </div>
    </div>
  );
}

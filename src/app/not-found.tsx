import { ButtonLink, PageHeading } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="space-y-4">
      <PageHeading title="We couldn't find that page" lead="The link may be old or mistyped." />
      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/dashboard">Go to my dashboard</ButtonLink>
        <ButtonLink href="/colleges" variant="secondary">Search colleges</ButtonLink>
        <ButtonLink href="/careers" variant="secondary">Explore careers</ButtonLink>
      </div>
    </div>
  );
}

import { ButtonLink, PageHeading } from "@/components/ui";

// Shown for a list entry that isn't there: removed (maybe in another tab), someone else's, or an
// old or mistyped link. Offers a way back instead of a dead end.
export default function ListEntryNotFound() {
  return (
    <div>
      <PageHeading
        title="We couldn't find that on your list"
        lead="It may have been removed, or the link may be old. Everything else on your list is still there."
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <ButtonLink href="/applications" className="w-full sm:w-auto">
          Go to my list
        </ButtonLink>
        <ButtonLink href="/colleges" variant="secondary" className="w-full sm:w-auto">
          Find colleges
        </ButtonLink>
      </div>
    </div>
  );
}

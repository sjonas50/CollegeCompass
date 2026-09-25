import Link from "next/link";
import type { ReactNode } from "react";
import { Button, ButtonLink, Field } from "@/components/ui";
import { CONTROLS, CONTROL_LABELS, CREDENTIALS, CREDENTIAL_LABELS, MISSIONS, MISSION_LABELS, SIZES, SIZE_LABELS } from "@/lib/colleges/labels";
import { type CollegeSearchFilters, SEARCH_PARAM_NAMES, SORTS, SORT_LABELS, collegeSearchHref } from "@/lib/colleges/search";
import { US_STATES } from "@/lib/colleges/states";

const selectClass =
  "mt-1 block min-h-11 w-full rounded-lg border border-border bg-surface px-3 focus-visible:outline-2 focus-visible:outline-accent";

function SelectField({
  label,
  name,
  defaultValue,
  hint,
  children,
}: {
  label: string;
  name: string;
  defaultValue?: string | number;
  hint?: string;
  children: ReactNode;
}) {
  const hintId = `${name}-hint`;
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      <select
        id={name}
        name={name}
        defaultValue={defaultValue === undefined ? "" : String(defaultValue)}
        aria-describedby={hint ? hintId : undefined}
        className={selectClass}
      >
        {children}
      </select>
    </div>
  );
}

function Checkbox({ name, label, checked }: { name: string; label: string; checked?: boolean }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm">
      <input type="checkbox" name={name} value="1" defaultChecked={checked} className="size-5 shrink-0 accent-accent" />
      {label}
    </label>
  );
}

/**
 * The /colleges search form. A plain GET form, so every search is a shareable link and works
 * without JavaScript. Family income is never part of it (see income-band.tsx).
 */
export function SearchForm({
  filters,
  majorTitle,
  majorIncludes = null,
  majorQuery,
}: {
  filters: CollegeSearchFilters;
  /** Title of the chosen major (shown as a removable chip). */
  majorTitle: string | null;
  /** The more familiar major name that matched what was typed, like "Welding Technology/Welder". */
  majorIncludes?: string | null;
  /** What was typed in the major field, when it didn't resolve to one major. */
  majorQuery: string | null;
}) {
  const moreOpen = Boolean(
    filters.credential || filters.control || filters.size || filters.hbcu || filters.hispanicServing || filters.tribal || filters.includeOnlineOnly,
  );
  const hasFilters = collegeSearchHref({ ...filters, page: undefined }) !== "/colleges" || Boolean(majorQuery);
  const removeMajorHref = collegeSearchHref({ ...filters, major: undefined, page: undefined });

  return (
    // "#results" brings phones straight to the results instead of back to the top of the form.
    <form action="/colleges#results" role="search" aria-label="Search colleges" className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <Field
        label="College name or city"
        name="q"
        defaultValue={filters.q ?? ""}
        hint="Like “state”, “tech” or “Houston”"
        autoComplete="off"
      />

      {filters.major ? (
        <div>
          <p className="text-sm font-medium">
            Major or program
          </p>
          <input type="hidden" name="major" value={filters.major} />
          <p className="mt-1 inline-flex min-h-11 max-w-full items-center gap-1 rounded-full bg-accent-soft py-0 pr-0 pl-4 text-sm font-medium">
            <span className="min-w-0">
              {majorTitle ?? "The major you picked"}
              {majorIncludes && <span className="font-normal"> (includes {majorIncludes})</span>}
            </span>
            <Link
              href={removeMajorHref}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-lg hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span aria-hidden="true">×</span>
              <span className="sr-only">Remove major: {majorTitle ?? "the major you picked"}</span>
            </Link>
          </p>
        </div>
      ) : (
        <Field
          label="Major or program"
          name={SEARCH_PARAM_NAMES.majorQuery}
          defaultValue={majorQuery ?? ""}
          hint="Like nursing, welding, biology or business"
          autoComplete="off"
        />
      )}

      <SelectField label="State" name="state" defaultValue={filters.state}>
        <option value="">Any state</option>
        {US_STATES.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name}
          </option>
        ))}
      </SelectField>

      <details open={moreOpen} className="group rounded-lg border border-border">
        {/* Left as a list item (not flex) so browsers keep the open/closed triangle. */}
        <summary className="min-h-11 cursor-pointer content-center px-3 font-medium focus-visible:outline-2 focus-visible:outline-accent">
          More filters
        </summary>
        <div className="space-y-4 border-t border-border p-3">
          <SelectField
            label="Type of program"
            name="credential"
            defaultValue={filters.credential}
            hint={
              filters.major
                ? "Colleges that offer your major at this level."
                : "Colleges where most students earn this."
            }
          >
            <option value="">Any type</option>
            {CREDENTIALS.map((c) => (
              <option key={c} value={c}>
                {CREDENTIAL_LABELS[c].option}
              </option>
            ))}
          </SelectField>

          <SelectField label="Public or private" name="control" defaultValue={filters.control}>
            <option value="">Any</option>
            {CONTROLS.map((c) => (
              <option key={c} value={c}>
                {CONTROL_LABELS[c]}
              </option>
            ))}
          </SelectField>

          <SelectField label="Size" name="size" defaultValue={filters.size}>
            <option value="">Any size</option>
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {SIZE_LABELS[s].label} ({SIZE_LABELS[s].detail})
              </option>
            ))}
          </SelectField>

          <fieldset>
            <legend className="text-sm font-medium">Colleges with a special mission</legend>
            <p className="text-sm text-muted">Check more than one to see colleges with any of them.</p>
            {MISSIONS.map((m) => (
              <Checkbox key={m} name={SEARCH_PARAM_NAMES[m]} label={MISSION_LABELS[m].label} checked={filters[m]} />
            ))}
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">Online colleges</legend>
            <Checkbox
              name={SEARCH_PARAM_NAMES.includeOnlineOnly}
              label="Include colleges where every class is online"
              checked={filters.includeOnlineOnly}
            />
          </fieldset>
        </div>
      </details>

      <SelectField label="Sort by" name="sort" defaultValue={filters.sort ?? "relevance"}>
        {SORTS.map((s) => (
          <option key={s} value={s}>
            {SORT_LABELS[s]}
          </option>
        ))}
      </SelectField>

      <div className="flex flex-wrap gap-2">
        <Button type="submit">Search</Button>
        {hasFilters && (
          <ButtonLink href="/colleges" variant="secondary">
            Clear all
          </ButtonLink>
        )}
      </div>
    </form>
  );
}

import Link from "next/link";
import { gradeQuestion } from "@/lib/auth/age";
import type { ComponentProps, ReactNode } from "react";

export function PageHeading({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {lead && <p className="mt-2 text-muted">{lead}</p>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-border bg-surface p-5 ${className}`}>{children}</section>;
}

const buttonBase =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60";
const buttonVariants = {
  primary: "bg-accent text-accent-foreground hover:opacity-90",
  secondary: "border border-border bg-surface hover:bg-background",
  danger: "bg-danger text-white hover:opacity-90",
} as const;

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof buttonVariants }) {
  return <button className={`${buttonBase} ${buttonVariants[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: keyof typeof buttonVariants }) {
  return <Link className={`${buttonBase} ${buttonVariants[variant]} ${className}`} {...props} />;
}

export function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p id={id} className="mt-1 text-sm text-danger">
      {errors[0]}
    </p>
  );
}

export function Field({
  label,
  name,
  errors,
  hint,
  ...inputProps
}: ComponentProps<"input"> & { label: string; name: string; errors?: string[]; hint?: string }) {
  const errorId = `${name}-error`;
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
      <input
        id={name}
        name={name}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={[hint && hintId, errors?.length && errorId].filter(Boolean).join(" ") || undefined}
        className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-surface px-3 focus-visible:outline-2 focus-visible:outline-accent"
        {...inputProps}
      />
      <FieldError id={errorId} errors={errors} />
    </div>
  );
}

export function gradeOptionLabel(g: number) {
  return g === 12 ? "12th grade" : `${g}th grade`;
}

export function GradeSelect({ errors, defaultValue }: { errors?: string[]; defaultValue?: string }) {
  const q = gradeQuestion();
  return (
    <div>
      <label htmlFor="grade" className="block text-sm font-medium">
        {q.label}
      </label>
      <select
        key={defaultValue ?? ""}
        id="grade"
        name="grade"
        required
        defaultValue={defaultValue ?? ""}
        aria-invalid={errors?.length ? true : undefined}
        className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-surface px-3"
      >
        <option value="" disabled>
          Choose a grade
        </option>
        {Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i).map((g) => (
          <option key={g} value={g}>
            {gradeOptionLabel(g)}
          </option>
        ))}
      </select>
      <FieldError id="grade-error" errors={errors} />
    </div>
  );
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Neutral birthday input: no defaults, no hint about which ages are allowed. */
export function BirthdayFields({
  legend,
  errors,
  defaults = {},
}: {
  legend: string;
  errors?: string[];
  defaults?: { month?: string; day?: string; year?: string };
}) {
  const select = "mt-1 block min-h-11 w-full rounded-lg border border-border bg-surface px-3";
  return (
    <fieldset>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="mt-1 grid grid-cols-[2fr_1fr_1.3fr] gap-2">
        <label className="text-sm text-muted">
          Month
          {/* Keyed so React remounts it with the new default after a form reset. */}
          <select key={defaults.month ?? ""} name="birthMonth" required defaultValue={defaults.month ?? ""} className={select}>
            <option value="" disabled>
              Month
            </option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-muted">
          Day
          <input name="birthDay" inputMode="numeric" pattern="[0-9]*" maxLength={2} required defaultValue={defaults.day} className={select} />
        </label>
        <label className="text-sm text-muted">
          Year
          <input name="birthYear" inputMode="numeric" pattern="[0-9]*" maxLength={4} required defaultValue={defaults.year} className={select} />
        </label>
      </div>
      <FieldError id="birthDate-error" errors={errors} />
    </fieldset>
  );
}

export function FormMessage({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-success-soft px-3 py-2 text-sm">{children}</p>;
}

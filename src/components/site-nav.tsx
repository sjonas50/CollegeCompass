"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLink = { href: string; label: string };

const HOME: NavLink[] = [
  { href: "/dashboard", label: "Home" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/plan", label: "Plan" },
  { href: "/counselor", label: "Counselor" },
];
const CAREERS: NavLink = { href: "/careers", label: "Careers" };
const COLLEGES: NavLink = { href: "/colleges", label: "Colleges" };
const LAUNCH: NavLink[] = [
  { href: "/applications", label: "My list" },
  { href: "/aid", label: "Paying for it" },
];

/**
 * The student's main links. In 11th and 12th grade, applying and paying for college come before
 * Careers, so on a phone they fill the second row instead of trailing at the end.
 */
export function studentNavLinks(grade: number | null): NavLink[] {
  return grade !== null && grade >= 11 ? [...HOME, COLLEGES, ...LAUNCH, CAREERS] : [...HOME, CAREERS, COLLEGES];
}

/** Primary navigation for signed-in students. Wraps onto more rows on narrow screens, so every link shows. */
export function StudentNav({ grade }: { grade: number | null }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main">
      <ul className="-mx-2.5 flex flex-wrap gap-x-1 text-sm sm:-mx-3">
        {studentNavLinks(grade).map((l) => {
          const active = pathname === l.href || pathname.startsWith(`${l.href}/`) || (l.href === "/dashboard" && pathname.startsWith("/discover"));
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-2.5 sm:px-3 ${active ? "bg-accent-soft font-medium" : "text-muted hover:text-foreground"}`}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

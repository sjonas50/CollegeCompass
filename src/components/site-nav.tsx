"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const STUDENT_LINKS = [
  { href: "/dashboard", label: "Home" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/plan", label: "Plan" },
  { href: "/counselor", label: "Counselor" },
  { href: "/careers", label: "Careers" },
];

/** Primary navigation for signed-in students. Scrolls horizontally on narrow screens. */
export function StudentNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="-mx-4 overflow-x-auto px-4">
      <ul className="flex gap-1 text-sm">
        {STUDENT_LINKS.map((l) => {
          const active = pathname === l.href || pathname.startsWith(`${l.href}/`) || (l.href === "/dashboard" && pathname.startsWith("/discover"));
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 ${active ? "bg-accent-soft font-medium" : "text-muted hover:text-foreground"}`}
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

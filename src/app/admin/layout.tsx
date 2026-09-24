import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: { default: "Staff", template: "%s · Staff · College Compass" },
  robots: { index: false, follow: false },
};

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/safety", label: "Safety review" },
  { href: "/admin/costs", label: "AI costs" },
] as const;

/**
 * Staff pages. Layouts don't re-run on every navigation, so each page (and every action) also
 * calls requireUser(["admin"]) itself.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireUser(["admin"]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border pb-3">
        <nav aria-label="Staff" className="flex flex-wrap gap-x-4">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-sm text-muted">
          <span>Signed in as staff: {admin.displayName}</span>
          <form action={logoutAction}>
            <button type="submit" className="min-h-11 underline">Sign out</button>
          </form>
        </div>
      </div>
      {children}
    </div>
  );
}

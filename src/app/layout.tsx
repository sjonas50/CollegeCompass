import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { StudentNav } from "@/components/site-nav";
import { getCurrentUser } from "@/lib/auth/dal";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  // Makes links in page metadata (like the aid guide's other-language versions) absolute.
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "College Compass", template: "%s · College Compass" },
  description:
    "Discover careers that fit you and build a grade-by-grade plan for college — for students in grades 7–12.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded focus:bg-surface focus:p-2">
          Skip to content
        </a>
        <header className="border-b border-border bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-2">
            <div className="flex min-h-11 items-center justify-between">
              <Link href={user ? (user.role === "parent" ? "/parent" : "/dashboard") : "/"} className="font-semibold tracking-tight">
                College Compass
              </Link>
            </div>
            {user?.role === "student" && <StudentNav grade={user.grade} />}
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-border px-4 py-6 text-center text-sm text-muted">
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-4 gap-y-2">
            <Link href="/careers" className="underline underline-offset-2">
              Explore careers
            </Link>
            <Link href="/colleges" className="underline underline-offset-2">
              Colleges
            </Link>
            <Link href="/aid" className="underline underline-offset-2">
              Financial aid guide
            </Link>
            <Link href="/about/data" className="underline underline-offset-2">
              Data sources
            </Link>
            <Link href="/privacy" className="underline underline-offset-2">
              Privacy
            </Link>
          </nav>
        </footer>
      </body>
    </html>
  );
}

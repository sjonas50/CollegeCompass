import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import Link from "next/link";
import { StudentNav } from "@/components/site-nav";
import { getCurrentUser, homePathFor } from "@/lib/auth/dal";
import "./globals.css";
import { PAGE_LANG_HEADER, SITE_LANG, documentLang } from "./page-lang";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  // Makes links in page metadata (like the aid guide's other-language versions) absolute.
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "College Compass", template: "%s · College Compass" },
  description:
    "Discover careers that fit you and build a grade-by-grade plan for college — for students in grades 7–12.",
};

const FOOTER_LINKS = [
  { href: "/careers", label: "Explore careers" },
  { href: "/colleges", label: "Colleges" },
  { href: "/aid", label: "Financial aid guide" },
  { href: "/about/data", label: "Data sources" },
  { href: "/privacy", label: "Privacy" },
];

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  // Spanish for the Spanish aid guide (set by src/proxy.ts from the path), otherwise English. The
  // site's own header and footer are always English, so they say so for themselves.
  const lang = documentLang((await headers()).get(PAGE_LANG_HEADER));
  return (
    <html lang={lang} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <a href="#main" lang={SITE_LANG} className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded focus:bg-surface focus:p-2">
          Skip to content
        </a>
        <header lang={SITE_LANG} className="border-b border-border bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-2">
            <div className="flex min-h-11 items-center justify-between">
              <Link href={user ? homePathFor(user) : "/"} className="font-semibold tracking-tight">
                College Compass
              </Link>
            </div>
            {user?.role === "student" && <StudentNav grade={user.grade} />}
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
          {children}
        </main>
        <footer lang={SITE_LANG} className="border-t border-border px-4 py-4 text-center text-sm text-muted">
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-4">
            {FOOTER_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-foreground">
                {l.label}
              </Link>
            ))}
          </nav>
        </footer>
      </body>
    </html>
  );
}

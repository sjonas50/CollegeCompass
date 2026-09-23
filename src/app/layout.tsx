import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "College Compass", template: "%s · College Compass" },
  description:
    "Discover careers that fit you and build a grade-by-grade plan for college — for students in grades 7–12.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded focus:bg-surface focus:p-2">
          Skip to content
        </a>
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              College Compass
            </Link>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-border px-4 py-6 text-center text-sm text-muted">
          <nav className="flex justify-center gap-4">
            <Link href="/careers" className="underline underline-offset-2">
              Explore careers
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

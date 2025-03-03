import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Authentication - College Compass',
  description: 'Sign in or create an account for College Compass',
};

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
} 
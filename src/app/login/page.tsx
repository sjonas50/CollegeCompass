import type { Metadata } from "next";
import { PageHeading } from "@/components/ui";
import { safeNext } from "@/lib/forms";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <>
      <PageHeading title="Welcome back" />
      <LoginForm next={safeNext(typeof next === "string" ? next : null) ?? undefined} />
    </>
  );
}

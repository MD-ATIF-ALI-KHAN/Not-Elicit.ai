import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthForm } from "../AuthForm";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <>
      <h1 className="mb-6 font-serif text-2xl font-semibold text-ink-950">Welcome back</h1>
      <AuthForm mode="login" next={typeof next === "string" ? next : undefined} />
    </>
  );
}

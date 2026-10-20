import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthForm } from "../AuthForm";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <>
      <h1 className="mb-1 font-serif text-2xl font-semibold text-ink-950">Create your account</h1>
      <p className="mb-6 text-sm text-slate-600">Save your research questions, tables, and uploaded papers.</p>
      <AuthForm mode="signup" next={typeof next === "string" ? next : undefined} />
    </>
  );
}

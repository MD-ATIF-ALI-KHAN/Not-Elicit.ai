"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, startSession } from "@/lib/auth";
import { allowAttempt, resetAttempts } from "@/lib/rate-limit";
import { authenticate, createUser, EmailTakenError, signupsOpen } from "@/lib/users";

const MINUTE = 60_000;
const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";

/** The client's address, for rate limiting (best effort behind proxies). */
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export type AuthState = { error?: string; email?: string; name?: string } | undefined;

/** Only allow redirects to local paths, never to another site. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}

const SignUp = z.object({
  name: z.string().trim().min(1, "Please enter your name.").max(80, "Please use a shorter name."),
  email: z.email("Please enter a valid email address.").max(200),
  password: z
    .string()
    .min(8, "Passwords must be at least 8 characters.")
    .max(200, "Passwords must be at most 200 characters."),
});

export async function signUp(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
  if (!signupsOpen()) return { error: "Sign-ups are closed on this server.", email: raw.email, name: raw.name };
  const parsed = SignUp.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, email: raw.email, name: raw.name };
  if (!allowAttempt(`signup:${await clientIp()}`, 10, 60 * MINUTE)) return { error: TOO_MANY, email: raw.email, name: raw.name };

  try {
    const user = await createUser(parsed.data);
    await startSession(user.id);
  } catch (error) {
    if (error instanceof EmailTakenError) return { error: error.message, email: raw.email, name: raw.name };
    throw error;
  }
  redirect(safeNext(formData.get("next")));
}

export async function logIn(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Please enter your email and password.", email };

  // Limit guesses per account and per address to slow down password guessing.
  const accountKey = `login:${email.toLowerCase()}`;
  const ipKey = `login-ip:${await clientIp()}`;
  if (!allowAttempt(accountKey, 10, 15 * MINUTE) || !allowAttempt(ipKey, 50, 15 * MINUTE)) return { error: TOO_MANY, email };

  const user = await authenticate(email, password);
  if (!user) return { error: "That email and password don't match an account.", email };
  resetAttempts(accountKey);
  await startSession(user.id);
  redirect(safeNext(formData.get("next")));
}

export async function logOut(): Promise<void> {
  await endSession();
  redirect("/");
}

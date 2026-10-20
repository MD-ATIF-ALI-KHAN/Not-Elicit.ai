import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { PublicUser } from "@/lib/types";
import { createSession, deleteSession, userForSessionToken } from "@/lib/users";

export const SESSION_COOKIE = "vs_session";

export async function startSession(userId: string): Promise<void> {
  const { token, expiresAt } = createSession(userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) deleteSession(token);
  store.delete(SESSION_COOKIE);
}

/** The signed-in user for this request, or null. Memoized per request. */
export const getCurrentUser = cache(async (): Promise<PublicUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? userForSessionToken(token) : null;
});

/** For pages: sends signed-out visitors to the login page. */
export async function requireUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

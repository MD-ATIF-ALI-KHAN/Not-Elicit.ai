"use client";

import Link from "next/link";
import { useActionState } from "react";
import { logIn, signUp, type AuthState } from "./actions";

const inputClass =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none " +
  "placeholder:text-slate-400 focus:border-ink-500 focus:ring-2 focus:ring-ink-200";

export function AuthForm({ mode, next }: { mode: "login" | "signup"; next?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "signup" ? signUp : logIn, undefined);
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";

  return (
    <form action={action} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      {mode === "signup" && (
        <label className="block text-sm font-medium text-slate-700">
          Name
          <input name="name" autoComplete="name" required defaultValue={state?.name} className={inputClass} />
        </label>
      )}
      <label className="block text-sm font-medium text-slate-700">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state?.email}
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Password
        <input
          name="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={mode === "signup" ? 8 : undefined}
          required
          className={inputClass}
        />
        {mode === "signup" && <span className="mt-1 block text-xs text-slate-500">At least 8 characters.</span>}
      </label>

      {state?.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-ink-800 px-4 py-2.5 font-medium text-white shadow-sm transition hover:bg-ink-900 disabled:opacity-60"
      >
        {pending ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"}
      </button>

      <p className="text-center text-sm text-slate-600">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href={`/login${nextQuery}`} className="font-medium text-ink-700 hover:underline">
              Log in
            </Link>
          </>
        ) : (
          <>
            New to Not-Elicit.ai?{" "}
            <Link href={`/signup${nextQuery}`} className="font-medium text-ink-700 hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

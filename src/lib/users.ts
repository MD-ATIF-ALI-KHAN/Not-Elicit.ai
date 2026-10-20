import "server-only";
import { getDb } from "@/lib/db";
import { newId, now } from "@/lib/ids";
import { hashPassword, hashSessionToken, newSessionToken, verifyPassword } from "@/lib/password";
import type { PublicUser } from "@/lib/types";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// A real hash of a throwaway password, compared against when the email is
// unknown so that login takes the same time whether or not the account exists.
let dummyHash: Promise<string> | undefined;

export class EmailTakenError extends Error {
  constructor() {
    super("An account with this email already exists.");
  }
}

export async function createUser(input: { email: string; name: string; password: string }): Promise<PublicUser> {
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw new EmailTakenError();
  const user = { id: newId(), email, name: input.name.trim() };
  const passwordHash = await hashPassword(input.password);
  db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(
    user.id,
    user.email,
    user.name,
    passwordHash,
    now(),
  );
  return user;
}

/**
 * Whether new accounts can be created. Set DISABLE_SIGNUPS=true on a shared
 * server once your own account exists; the first account can always be made.
 */
export function signupsOpen(): boolean {
  if (process.env.DISABLE_SIGNUPS !== "true") return true;
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  return row.n === 0;
}

export async function authenticate(email: string, password: string): Promise<PublicUser | null> {
  const row = getDb()
    .prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as { id: string; email: string; name: string; password_hash: string } | undefined;
  if (!row) {
    dummyHash ??= hashPassword("not-a-real-password");
    await verifyPassword(password, await dummyHash);
    return null;
  }
  if (!(await verifyPassword(password, row.password_hash))) return null;
  return { id: row.id, email: row.email, name: row.name };
}

export function createSession(userId: string): { token: string; expiresAt: number } {
  const token = newSessionToken();
  const createdAt = now();
  const expiresAt = createdAt + SESSION_TTL_MS;
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(createdAt);
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    hashSessionToken(token),
    userId,
    expiresAt,
    createdAt,
  );
  return { token, expiresAt };
}

export function userForSessionToken(token: string): PublicUser | null {
  const row = getDb()
    .prepare(
      `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashSessionToken(token), now()) as PublicUser | undefined;
  return row ? { id: row.id, email: row.email, name: row.name } : null;
}

export function deleteSession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
}

import { describe, expect, it } from "vitest";
import { hashPassword, hashSessionToken, newSessionToken, verifyPassword } from "@/lib/password";

describe("passwords", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("Correct horse battery", hash)).toBe(false);
  });

  it("salts each hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$2$3$4$5")).toBe(false);
  });
});

describe("session tokens", () => {
  it("are random and hashed deterministically", () => {
    const a = newSessionToken();
    expect(a).not.toBe(newSessionToken());
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(hashSessionToken(a)).toBe(hashSessionToken(a));
    expect(hashSessionToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

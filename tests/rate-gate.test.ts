import { describe, expect, it } from "vitest";
import { RateGate, retryDelayMs } from "@/lib/ai/rate-gate";

function fakeClock() {
  let time = 0;
  const sleeps: number[] = [];
  return {
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
    },
    advance: (ms: number) => (time += ms),
    sleeps,
  };
}

describe("RateGate", () => {
  it("lets requests through immediately when unconstrained", async () => {
    const clock = fakeClock();
    const gate = new RateGate(null, clock.sleep, clock.now);
    for (let i = 0; i < 20; i++) await gate.acquire();
    expect(clock.sleeps).toEqual([]);
  });

  it("caps requests per rolling minute", async () => {
    const clock = fakeClock();
    const gate = new RateGate(3, clock.sleep, clock.now);
    await gate.acquire();
    clock.advance(10_000);
    await gate.acquire();
    await gate.acquire();
    // The fourth must wait until the first is a minute old.
    await gate.acquire();
    expect(clock.sleeps).toEqual([50_050]);
    expect(clock.now()).toBe(60_050);
  });

  it("holds every request during a pause", async () => {
    const clock = fakeClock();
    const gate = new RateGate(null, clock.sleep, clock.now);
    gate.pause(5_000);
    gate.pause(2_000); // a shorter pause never shortens an existing one
    await Promise.all([gate.acquire(), gate.acquire()]);
    expect(clock.now()).toBeGreaterThanOrEqual(5_000);
  });
});

describe("retryDelayMs", () => {
  const headers = (entries: Record<string, string> = {}) => new Headers(entries);

  it("reads Retry-After", () => {
    expect(retryDelayMs(headers({ "retry-after": "3" }), "")).toBe(3000);
  });

  it("reads Gemini's message and RetryInfo", () => {
    expect(retryDelayMs(headers(), "Quota exceeded. Please retry in 12.5s.")).toBe(12_500);
    expect(retryDelayMs(headers(), '{"@type": "RetryInfo", "retryDelay": "41s"}')).toBe(41_000);
  });

  it("reads Groq's minutes-and-seconds message", () => {
    expect(retryDelayMs(headers(), "Rate limit reached. Please try again in 1m2.5s.")).toBe(62_500);
  });

  it("reads OpenRouter's reset timestamp", () => {
    expect(retryDelayMs(headers({ "x-ratelimit-reset": "105000" }), "", 100_000)).toBe(5_000);
  });

  it("returns null without a hint", () => {
    expect(retryDelayMs(headers(), "Too many requests")).toBeNull();
  });
});

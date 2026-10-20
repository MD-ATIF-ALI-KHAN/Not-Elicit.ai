// Keeps requests to one AI provider within its rate limit. Free tiers allow
// only a few requests per minute, so when the provider says "slow down" every
// waiting request pauses together instead of each one retrying and failing.

export class RateGate {
  private pausedUntil = 0;
  private started: number[] = [];

  constructor(
    /** Optional proactive cap; null relies only on the provider's 429 replies. */
    private readonly perMinute: number | null,
    private readonly sleep: (ms: number) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  /** Waits until a request may start, then counts it. */
  async acquire(): Promise<void> {
    for (;;) {
      const time = this.now();
      if (time < this.pausedUntil) {
        await this.sleep(this.pausedUntil - time);
        continue;
      }
      if (this.perMinute) {
        this.started = this.started.filter((start) => time - start < 60_000);
        if (this.started.length >= this.perMinute) {
          await this.sleep(60_000 - (time - this.started[0]) + 50);
          continue;
        }
      }
      this.started.push(time);
      return;
    }
  }

  /** Holds every request for `ms` (e.g. after a 429 with a retry delay). */
  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
  }
}

/**
 * How long a rate-limited response asks us to wait, in milliseconds, or null.
 * Understands the Retry-After header plus the hints Gemini ("Please retry in
 * 12.6s", "retryDelay": "12s"), Groq ("try again in 1m2.5s") and OpenRouter
 * (X-RateLimit-Reset, epoch milliseconds) put in their responses.
 */
export function retryDelayMs(headers: Headers, body: string, now: number = Date.now()): number | null {
  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null && retryAfter.trim() !== "" && Number.isFinite(Number(retryAfter))) {
    return Math.max(0, Number(retryAfter) * 1000);
  }
  const minutesSeconds = /(?:retry|try again)[^0-9]{0,20}?(?:(\d+)m)?(\d+(?:\.\d+)?)s\b/i.exec(body);
  if (minutesSeconds) return (Number(minutesSeconds[1] ?? 0) * 60 + Number(minutesSeconds[2])) * 1000;
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > now) return reset - now;
  return null;
}

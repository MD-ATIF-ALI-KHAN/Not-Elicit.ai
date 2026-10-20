// Turns a streamed answer containing inline [n] citation markers into the
// same segment/text/citation events that Claude's native citations produce.

import type { SummaryEvent } from "./provider";

const MARKER = /^\[\s*\d+(?:\s*[-–,]\s*\d+)*\s*\]/;
// A "[" followed only by characters a marker can contain, not yet closed.
const PARTIAL_MARKER = /^\[[\d\s,\-–]*$/;
const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/** Expands "1, 3-5" to [1, 3, 4, 5]. */
export function markerNumbers(marker: string): number[] {
  const numbers: number[] = [];
  for (const part of marker.slice(1, -1).split(",")) {
    const [start, end] = part.split(/[-–]/).map((n) => Number.parseInt(n.trim(), 10));
    if (end === undefined) numbers.push(start);
    else for (let n = start; n <= end && n - start < 50; n++) numbers.push(n);
  }
  return numbers;
}

function partialPrefix(buffer: string, token: string): number {
  // Length of the longest suffix of `buffer` that is a prefix of `token`.
  for (let length = Math.min(token.length - 1, buffer.length); length > 0; length--) {
    if (token.startsWith(buffer.slice(-length))) return length;
  }
  return 0;
}

export class CitationStreamParser {
  private buffer = "";
  private inThink = false;
  private started = false;
  /** A marker just closed; the next real text starts a new segment. */
  private segmentPending = false;
  /** Whitespace seen right after a marker, held in case another marker follows. */
  private heldSpace = "";

  constructor(private readonly paperIds: string[]) {}

  push(chunk: string): SummaryEvent[] {
    this.buffer += chunk;
    return this.drain(false);
  }

  end(): SummaryEvent[] {
    const events = this.drain(true);
    if (this.heldSpace) this.emitText(this.heldSpace, events);
    this.heldSpace = "";
    return events;
  }

  private emitText(text: string, events: SummaryEvent[]): void {
    if (!text) return;
    if (!this.started) {
      events.push({ type: "segment" });
      this.started = true;
    }
    if (this.segmentPending) {
      if (!text.trim()) {
        this.heldSpace += text;
        return;
      }
      events.push({ type: "segment" });
      this.segmentPending = false;
      text = this.heldSpace + text;
      this.heldSpace = "";
    }
    events.push({ type: "text", text });
  }

  private drain(final: boolean): SummaryEvent[] {
    const events: SummaryEvent[] = [];
    while (this.buffer) {
      if (this.inThink) {
        const close = this.buffer.indexOf(THINK_CLOSE);
        if (close === -1) {
          // Discard reasoning, keeping only a possible partial closing tag.
          this.buffer = final ? "" : this.buffer.slice(this.buffer.length - partialPrefix(this.buffer, THINK_CLOSE));
          break;
        }
        this.buffer = this.buffer.slice(close + THINK_CLOSE.length);
        this.inThink = false;
        continue;
      }

      const bracket = this.buffer.indexOf("[");
      const think = this.buffer.indexOf(THINK_OPEN);
      const next = [bracket, think].filter((i) => i >= 0).sort((a, b) => a - b)[0];

      if (next === undefined) {
        // Hold back a trailing fragment that could be the start of "<think>".
        const hold = final ? 0 : partialPrefix(this.buffer, THINK_OPEN);
        this.emitText(this.buffer.slice(0, this.buffer.length - hold), events);
        this.buffer = this.buffer.slice(this.buffer.length - hold);
        break;
      }

      this.emitText(this.buffer.slice(0, next), events);
      this.buffer = this.buffer.slice(next);

      if (next === think) {
        this.buffer = this.buffer.slice(THINK_OPEN.length);
        this.inThink = true;
        continue;
      }

      const marker = MARKER.exec(this.buffer)?.[0];
      if (marker) {
        const ids = markerNumbers(marker)
          .map((n) => this.paperIds[n - 1])
          .filter((id): id is string => Boolean(id));
        if (ids.length > 0) {
          if (!this.started) {
            events.push({ type: "segment" });
            this.started = true;
          }
          this.heldSpace = "";
          for (const paperId of ids) events.push({ type: "citation", paperId });
          this.segmentPending = true;
        }
        // Markers that cite no known paper are dropped.
        this.buffer = this.buffer.slice(marker.length);
        continue;
      }

      if (!final && PARTIAL_MARKER.test(this.buffer) && this.buffer.length < 40) break; // wait for more text
      this.emitText("[", events);
      this.buffer = this.buffer.slice(1);
    }
    return events;
  }
}

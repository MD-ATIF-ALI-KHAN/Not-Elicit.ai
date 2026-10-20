import { describe, expect, it } from "vitest";
import { applySummaryEvent, readNdjson } from "@/lib/summary-stream";
import type { SummarySegment, SummaryStreamEvent } from "@/lib/types";

describe("applySummaryEvent", () => {
  it("builds segments from segment, text and citation events", () => {
    const events: SummaryStreamEvent[] = [
      { type: "segment" },
      { type: "text", text: "Creatine " },
      { type: "text", text: "may help." },
      { type: "segment" },
      { type: "citation", paperId: "p1" },
      { type: "citation", paperId: "p1" },
      { type: "citation", paperId: "p2" },
      { type: "text", text: " Memory improved." },
    ];
    const segments = events.reduce<SummarySegment[]>(applySummaryEvent, []);
    expect(segments).toEqual([
      { text: "Creatine may help.", paperIds: [] },
      { text: " Memory improved.", paperIds: ["p1", "p2"] },
    ]);
  });

  it("does not mutate the previous state", () => {
    const before: SummarySegment[] = [{ text: "a", paperIds: [] }];
    const after = applySummaryEvent(before, { type: "text", text: "b" });
    expect(before[0].text).toBe("a");
    expect(after[0].text).toBe("ab");
  });

  it("starts a segment when text arrives first", () => {
    expect(applySummaryEvent([], { type: "text", text: "x" })).toEqual([{ text: "x", paperIds: [] }]);
    expect(applySummaryEvent([], { type: "citation", paperId: "p" })).toEqual([{ text: "", paperIds: ["p"] }]);
  });

  it("ignores done and error events", () => {
    const segments: SummarySegment[] = [{ text: "a", paperIds: [] }];
    expect(applySummaryEvent(segments, { type: "error", message: "x" })).toBe(segments);
  });
});

describe("readNdjson", () => {
  function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
        controller.close();
      },
    });
  }

  it("parses lines split across chunks, including inside a multi-byte character", async () => {
    const events: unknown[] = [];
    const full = '{"a":1}\n{"b":"naïve ✓"}\n\n{"c":3}';
    const bytes = new TextEncoder().encode(full);
    // "ï" is two bytes in UTF-8; cut between them.
    const cut = new TextEncoder().encode(full.slice(0, full.indexOf("ï"))).length + 1;
    await readNdjson(streamOf([bytes.slice(0, cut), bytes.slice(cut)]), (event) => events.push(event));
    expect(events).toEqual([{ a: 1 }, { b: "naïve ✓" }, { c: 3 }]);
  });

  it("propagates errors thrown by the handler", async () => {
    await expect(
      readNdjson(streamOf(['{"type":"error"}\n']), () => {
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
  });
});

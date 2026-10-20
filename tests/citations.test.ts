import { describe, expect, it } from "vitest";
import { CitationStreamParser, markerNumbers } from "@/lib/ai/citations";
import type { SummaryEvent } from "@/lib/ai/provider";
import { applySummaryEvent } from "@/lib/summary-stream";
import type { SummarySegment } from "@/lib/types";

const ids = ["p1", "p2", "p3", "p4", "p5"];

/** Feeds `chunks` through a parser and returns the events and resulting segments. */
function run(chunks: string[]) {
  const parser = new CitationStreamParser(ids);
  const events: SummaryEvent[] = [];
  for (const chunk of chunks) events.push(...parser.push(chunk));
  events.push(...parser.end());
  const segments = events.reduce<SummarySegment[]>(applySummaryEvent, []);
  return { events, segments };
}

describe("markerNumbers", () => {
  it("expands lists and ranges", () => {
    expect(markerNumbers("[1]")).toEqual([1]);
    expect(markerNumbers("[2, 5]")).toEqual([2, 5]);
    expect(markerNumbers("[1-3, 5]")).toEqual([1, 2, 3, 5]);
    expect(markerNumbers("[2–4]")).toEqual([2, 3, 4]);
  });
});

describe("CitationStreamParser", () => {
  it("attaches markers to the text before them", () => {
    const { segments } = run(["Creatine improved memory [1]. Effects were small [2, 3]. More work is needed."]);
    expect(segments).toEqual([
      { text: "Creatine improved memory ", paperIds: ["p1"] },
      { text: ". Effects were small ", paperIds: ["p2", "p3"] },
      { text: ". More work is needed.", paperIds: [] },
    ]);
  });

  it("produces the same result however the stream is chunked", () => {
    const text = "Memory improved [1][2] in adults [3-4], but not children [5].";
    const whole = run([text]).segments;
    const byChar = run([...text]).segments;
    const odd = run(["Memory improved [", "1][", "2] in adults [3", "-4], but not children [5", "]."]).segments;
    expect(byChar).toEqual(whole);
    expect(odd).toEqual(whole);
    expect(whole[0]).toEqual({ text: "Memory improved ", paperIds: ["p1", "p2"] });
  });

  it("keeps ordinary brackets as text and drops markers for unknown papers", () => {
    const { segments } = run(["Doses [in grams] varied [9]; see [2]."]);
    expect(segments).toEqual([
      { text: "Doses [in grams] varied ; see ", paperIds: ["p2"] },
      { text: ".", paperIds: [] },
    ]);
  });

  it("emits an unfinished bracket at the end of the stream", () => {
    expect(run(["Ends with [1"]).segments).toEqual([{ text: "Ends with [1", paperIds: [] }]);
  });

  it("removes <think> reasoning blocks, even when split across chunks", () => {
    const { segments } = run(["<thi", "nk>Let me consider [1] carefully.</th", "ink>Answer: yes [1]."]);
    expect(segments).toEqual([
      { text: "Answer: yes ", paperIds: ["p1"] },
      { text: ".", paperIds: [] },
    ]);
  });

  it("starts with a segment event so clients can render immediately", () => {
    expect(run(["Hello"]).events[0]).toEqual({ type: "segment" });
    expect(run(["[1] first"]).events.slice(0, 2)).toEqual([{ type: "segment" }, { type: "citation", paperId: "p1" }]);
  });
});

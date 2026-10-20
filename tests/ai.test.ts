import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ClaudeProvider, searchResultBlocks, segmentsFromContent } from "@/lib/ai/claude";
import { AiRefusalError, AiUnavailableError } from "@/lib/ai/errors";
import {
  chatReply,
  decide,
  extractCells,
  planSearchQuery,
  screenPaper,
  segmentsToMarkedText,
  summarize,
  writeReport,
} from "@/lib/ai/features";
import { buildExtractionPrompt, buildScreeningPrompt, cellsFromAnswers } from "@/lib/ai/prompts";
import type { AiProvider, CitedRequest, JsonRequest, SummaryEvent } from "@/lib/ai/provider";
import { setProviderForTesting } from "@/lib/ai/registry";
import type { ExtractionColumn } from "@/lib/types";
import { paper } from "./helpers";

const columns: ExtractionColumn[] = [
  { id: "c1", searchId: "search-1", name: "Population", instructions: "Who was studied", position: 0 },
  { id: "c2", searchId: "search-1", name: "Findings", instructions: "", position: 1 },
];

/** A Claude provider backed by a stand-in client exposing only what Not-Elicit.ai calls. */
function claude(beta: { parse?: unknown; stream?: unknown }) {
  const client = { beta: { messages: beta } } as unknown as Anthropic;
  return new ClaudeProvider({ model: "claude-opus-5-5", apiKey: "test" }, client);
}

function fakeStream(events: unknown[], finalMessage: unknown) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* events;
    },
    finalMessage: async () => finalMessage,
  };
}

const location = { cited_text: "", source: "s", title: null, start_block_index: 0, end_block_index: 1 };

describe("prompts", () => {
  it("lists every column id and says where the paper text is", () => {
    const prompt = buildExtractionPrompt("Q?", paper(), columns, false);
    expect(prompt).toContain('column_id "c1": Population — Who was studied');
    expect(prompt).toContain('column_id "c2": Findings');
    expect(prompt).toContain("Abstract: Creatine improved working memory");
    expect(buildExtractionPrompt("Q?", paper(), columns, true)).toContain("attached paper (full text)");
  });

  it("numbers screening criteria", () => {
    expect(buildScreeningPrompt("Q?", paper(), ["Adults", "RCT"], false)).toContain("1. Adults\n2. RCT");
  });

  it("maps answers onto columns, defaulting missing ones", () => {
    expect(
      cellsFromAnswers("paper-1", columns, [
        { column_id: "c2", value: " Improved memory ", supporting_quote: " improved working memory " },
        { column_id: "unknown", value: "ignored", supporting_quote: "" },
      ]),
    ).toEqual([
      { paperId: "paper-1", columnId: "c1", value: "Not reported", quote: "" },
      { paperId: "paper-1", columnId: "c2", value: "Improved memory", quote: "improved working memory" },
    ]);
  });
});

describe("ClaudeProvider", () => {
  it("sends sources as citable search results", () => {
    expect(searchResultBlocks([{ id: "a", title: "T (X, 2020)", url: null, text: "" }])).toEqual([
      {
        type: "search_result",
        source: "not-elicit:source:a",
        title: "T (X, 2020)",
        content: [{ type: "text", text: "No text available." }],
        citations: { enabled: true },
      },
    ]);
  });

  it("turns cited text blocks into segments mapped to source ids", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "s" },
      { type: "text", text: "Overall, ", citations: null },
      { type: "text", text: "the evidence is mixed. ", citations: [] },
      {
        type: "text",
        text: "Memory improved",
        citations: [
          { type: "search_result_location", search_result_index: 1, ...location },
          { type: "search_result_location", search_result_index: 1, ...location },
          { type: "search_result_location", search_result_index: 0, ...location },
          { type: "search_result_location", search_result_index: 9, ...location },
        ],
      },
      { type: "text", text: ".", citations: null },
    ] as unknown as Anthropic.Beta.BetaContentBlock[];
    expect(segmentsFromContent(content, ["a", "b"])).toEqual([
      { text: "Overall, the evidence is mixed. ", paperIds: [] },
      { text: "Memory improved", paperIds: ["b", "a"] },
      { text: ".", paperIds: [] },
    ]);
  });

  it("streams cited text with history, and opts into refusal fallbacks", async () => {
    const final = {
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "It helps.", citations: [{ type: "search_result_location", search_result_index: 0, ...location }] }],
    };
    const stream = vi.fn(() =>
      fakeStream(
        [
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: [] } },
          { type: "content_block_delta", index: 0, delta: { type: "citations_delta", citation: { type: "search_result_location", search_result_index: 0 } } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "It helps." } },
        ],
        final,
      ),
    );
    const events: SummaryEvent[] = [];
    const result = await claude({ stream }).streamCited(
      {
        system: "S",
        history: [
          { role: "user", text: "Earlier?" },
          { role: "assistant", text: "Earlier answer [1]." },
        ],
        prompt: "Now?",
        sources: [{ id: "a", title: "T", url: null, text: "Abstract" }],
      },
      (event) => events.push(event),
    );

    expect(events).toEqual([{ type: "segment" }, { type: "citation", paperId: "a" }, { type: "text", text: "It helps." }]);
    expect(result).toEqual({ segments: [{ text: "It helps.", paperIds: ["a"] }], model: "claude-opus-5-5" });
    const [params] = stream.mock.calls[0] as unknown as [{ messages: { role: string }[]; fallbacks: string; betas: string[]; system: string }];
    expect(params).toMatchObject({ fallbacks: "default", betas: ["server-side-fallback-2026-07-01"], system: "S" });
    expect(params.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("raises on a refused stream", async () => {
    const stream = () => fakeStream([], { model: "m", stop_reason: "refusal", content: [] });
    const request: CitedRequest = { system: "S", prompt: "Q", sources: [] };
    await expect(claude({ stream }).streamCited(request, () => {})).rejects.toBeInstanceOf(AiRefusalError);
  });

  it("returns structured output, attaching PDFs as cached documents", async () => {
    const parse = vi.fn(async () => ({ stop_reason: "end_turn", parsed_output: { query: "q" } }));
    const schema = z.object({ query: z.string() });
    const request: JsonRequest = { prompt: "P", pdf: { data: new TextEncoder().encode("%PDF-"), title: "T" } };
    expect(await claude({ parse }).json(schema, request)).toEqual({ query: "q" });
    const [params] = parse.mock.calls[0] as unknown as [{ messages: { content: Record<string, unknown>[] }[] }];
    expect(params.messages[0].content[0]).toMatchObject({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" },
      cache_control: { type: "ephemeral" },
    });
  });

  it("raises on refusals, missing output, and missing credentials", async () => {
    const schema = z.object({ a: z.string() });
    await expect(
      claude({ parse: async () => ({ stop_reason: "refusal", parsed_output: null }) }).json(schema, { prompt: "P" }),
    ).rejects.toBeInstanceOf(AiRefusalError);
    await expect(
      claude({ parse: async () => ({ stop_reason: "max_tokens", parsed_output: null }) }).json(schema, { prompt: "P" }),
    ).rejects.toThrow(/max_tokens/);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const noCredentials = claude({
      parse: async () => {
        throw new Error("Could not resolve authentication method.");
      },
    });
    await expect(noCredentials.json(schema, { prompt: "P" })).rejects.toBeInstanceOf(AiUnavailableError);
  });
});

describe("features", () => {
  /** A provider that records requests and replies with canned output. */
  function fakeProvider(json: unknown, segments = [{ text: "Answer", paperIds: [] as string[] }]) {
    const calls = { json: [] as JsonRequest[], cited: [] as CitedRequest[] };
    const provider: AiProvider = {
      label: "Fake",
      model: "fake-1",
      json: async (_schema, request) => {
        calls.json.push(request);
        if (json instanceof Error) throw json;
        return json as never;
      },
      streamCited: async (request, onEvent) => {
        calls.cited.push(request);
        onEvent({ type: "segment" });
        return { segments, model: "fake-1" };
      },
    };
    setProviderForTesting(provider);
    return calls;
  }

  afterEach(() => setProviderForTesting(undefined));

  it("plans queries, falling back to the question on failure", async () => {
    fakeProvider({ query: " creatine memory " });
    expect(await planSearchQuery("Does creatine help?")).toBe("creatine memory");
    fakeProvider(new Error("down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await planSearchQuery("raw question")).toBe("raw question");
  });

  it("summarizes from abstracts and records which papers were read", async () => {
    const calls = fakeProvider(null);
    const summary = await summarize("Q?", [paper(), paper({ id: "p2", abstract: null })], () => {});
    expect(summary).toMatchObject({ paperIds: ["paper-1", "p2"], model: "fake-1" });
    expect(calls.cited[0].sources[0]).toMatchObject({ id: "paper-1", title: "Creatine and cognition (Ada Lovelace et al., 2023)" });
    expect(calls.cited[0].sources[1].text).toBe("No abstract available.");
  });

  it("gives the report the extracted table details", async () => {
    const calls = fakeProvider(null);
    await writeReport(
      { question: "Q?", papers: [paper()], columns, cells: [{ paperId: "paper-1", columnId: "c1", value: "40 adults", quote: "" }] },
      () => {},
    );
    expect(calls.cited[0].system).toContain("## Key findings");
    expect(calls.cited[0].sources[0].text).toContain("Extracted details:\n- Population: 40 adults");
  });

  it("extracts cells, passing PDFs through", async () => {
    const calls = fakeProvider({ answers: [{ column_id: "c1", value: "40", supporting_quote: "forty" }] });
    const pdf = new Uint8Array([1]);
    const cells = await extractCells({ question: "Q?", paper: paper(), columns, pdf });
    expect(cells[0]).toEqual({ paperId: "paper-1", columnId: "c1", value: "40", quote: "forty" });
    expect(calls.json[0].pdf).toEqual({ data: pdf, title: "Creatine and cognition" });
    expect(await extractCells({ question: "Q?", paper: paper(), columns: [] })).toEqual([]);
  });

  it("screens papers and decides from the criteria", async () => {
    fakeProvider({
      criteria: [
        { index: 1, met: "yes", note: "Adults aged 60+." },
        { index: 2, met: "unclear", note: "Design not stated." },
      ],
    });
    const screening = await screenPaper({ question: "Q?", paper: paper(), criteria: ["Adults", "RCT", "English"] });
    expect(screening).toMatchObject({ paperId: "paper-1", decision: "maybe", overridden: false });
    expect(screening.results.map((r) => r.met)).toEqual(["yes", "unclear", "unclear"]);
    expect(screening.results[2].note).toBe("Not assessed.");
  });

  it("decides include, maybe or exclude", () => {
    const r = (met: "yes" | "no" | "unclear") => ({ criterion: "C", met, note: "n" });
    expect(decide([r("yes"), r("yes")]).decision).toBe("include");
    expect(decide([r("yes"), r("unclear")]).decision).toBe("maybe");
    expect(decide([r("unclear"), r("no")])).toEqual({ decision: "exclude", reason: "C: n" });
  });

  it("chats with full text when available and keeps history", async () => {
    const calls = fakeProvider(null);
    await chatReply(
      {
        history: [{ role: "user", text: "Hi" }],
        message: "What did they find?",
        sources: [
          { id: "s1", position: 1, title: "T", authors: [], year: 2020, url: null, abstract: "Abs", fullText: "Body" },
          { id: "s2", position: 2, title: "U", authors: [], year: null, url: null, abstract: null, fullText: null },
        ],
      },
      () => {},
    );
    expect(calls.cited[0].history).toEqual([{ role: "user", text: "Hi" }]);
    expect(calls.cited[0].sources[0].text).toBe("Abstract: Abs\n\nFull text:\nBody");
    expect(calls.cited[0].sources[1].text).toBe("No abstract available.");
  });

  it("writes earlier answers back with [n] markers", () => {
    const positions = new Map([
      ["a", 1],
      ["b", 3],
    ]);
    expect(
      segmentsToMarkedText(
        [
          { text: "Helps", paperIds: ["a", "b", "gone"] },
          { text: ". Done.", paperIds: [] },
        ],
        (id) => positions.get(id),
      ),
    ).toBe("Helps[1, 3]. Done.");
  });
});

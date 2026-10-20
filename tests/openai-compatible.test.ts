import { describe, expect, it, vi } from "vitest";
import { AiRateLimitError, AiRefusalError, AiRequestError, AiUnavailableError } from "@/lib/ai/errors";
import { extractJson, OpenAiCompatibleProvider } from "@/lib/ai/openai-compatible";
import { ExtractionResult, PdfMetadata, SearchPlan } from "@/lib/ai/prompts";
import type { SummaryEvent } from "@/lib/ai/provider";
import { extractPdfText } from "@/lib/pdf-text";
import { makePdf } from "./pdf";

const config = { label: "Gemini", model: "gemini-test", baseUrl: "https://example.test/v1", apiKey: "secret" };

const reply = (content: string | null, finish_reason = "stop") =>
  Response.json({ choices: [{ message: { content }, finish_reason }] });

function sse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

const delta = (content: string, finish_reason: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\n\n`;

/** A provider whose HTTP calls return `responses` in order. */
function provider(...responses: (Response | Error)[]) {
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return next;
  });
  // A fake clock that sleeping advances, so waits are instant but still measured.
  let clock = 1_000_000;
  const sleep = vi.fn(async (ms: number) => {
    clock += ms;
  });
  const instance = new OpenAiCompatibleProvider(config, {
    fetch: fetch as unknown as typeof globalThis.fetch,
    sleep,
    now: () => clock,
    requestsPerMinute: null,
  });
  const body = (call: number) => JSON.parse((fetch.mock.calls[call] as unknown as [string, RequestInit])[1].body as string);
  return { instance, fetch, sleep, body };
}

/** A structured request, as search planning makes. */
async function query(instance: OpenAiCompatibleProvider, prompt: string): Promise<string> {
  return (await instance.json(SearchPlan, { prompt })).query.trim();
}

describe("extractJson", () => {
  it("finds JSON in fences, after reasoning, or surrounded by prose", () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('<think>maybe {"no": 1}</think>{"a": 2}')).toEqual({ a: 2 });
    expect(extractJson('Here you go: {"a": {"b": 3}} Hope that helps')).toEqual({ a: { b: 3 } });
    expect(() => extractJson("no json here")).toThrow(SyntaxError);
  });
});

describe("JSON requests", () => {
  it("sends an authenticated JSON-mode request and parses the reply", async () => {
    const { instance, fetch, body } = provider(reply('```json\n{"query": " creatine cognition "}\n```'));
    expect(await query(instance, "Does creatine help?")).toBe("creatine cognition");

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.test/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    expect(body(0)).toMatchObject({ model: "gemini-test", response_format: { type: "json_object" } });
    expect(body(0).messages[0].content).toContain('"query"');
  });

  it("asks again with the validation error when the JSON is wrong", async () => {
    const { instance, fetch, body } = provider(reply('{"answers": "oops"}'), reply('{"answers": []}'));
    expect(await instance.json(ExtractionResult, { prompt: "P" })).toEqual({ answers: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(body(1).messages.at(-1).content).toMatch(/not valid: answers/);
  });

  it("gives up after a second invalid reply", async () => {
    const { instance } = provider(reply("not json"), reply("still not json"));
    await expect(query(instance, "Q")).rejects.toThrow(/did not return valid structured output/);
  });

  it("retries without JSON mode if the model rejects it", async () => {
    const { instance, body } = provider(
      Response.json({ error: { message: "response_format not supported" } }, { status: 400 }),
      reply('{"query": "q"}'),
    );
    expect(await query(instance, "Q")).toBe("q");
    expect(body(0).response_format).toBeDefined();
    expect(body(1).response_format).toBeUndefined();
  });

  it("waits and retries when rate limited, honouring Retry-After", async () => {
    const { instance, sleep } = provider(
      new Response("", { status: 429, headers: { "retry-after": "7" } }),
      new Response("", { status: 503 }),
      reply('{"query": "q"}'),
    );
    expect(await query(instance, "Q")).toBe("q");
    // 7s (+250ms margin) for the 429, then 4s backoff for the 503.
    expect(sleep.mock.calls).toEqual([[7250], [4000]]);
  });

  it("waits as long as Gemini's error body asks", async () => {
    const gemini429 = Response.json(
      [{ error: { code: 429, message: "Quota exceeded, limit: 5. Please retry in 12.614579876s.", status: "RESOURCE_EXHAUSTED" } }],
      { status: 429 },
    );
    const { instance, sleep } = provider(gemini429, reply('{"query": "q"}'));
    expect(await query(instance, "Q")).toBe("q");
    expect(sleep.mock.calls[0][0]).toBeCloseTo(12_864.58, 0);
  });

  it("reports persistent rate limits after backing off", async () => {
    const limited = () => new Response("", { status: 429 });
    const { instance, fetch, sleep } = provider(limited(), limited(), limited(), limited(), limited(), limited());
    await expect(query(instance, "Q")).rejects.toBeInstanceOf(AiRateLimitError);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2250, 4250, 8250, 16250, 32250]);
  });

  it("gives up on repeated server errors sooner", async () => {
    const broken = () => new Response("", { status: 502 });
    const { instance, fetch } = provider(broken(), broken(), broken());
    await expect(query(instance, "Q")).rejects.toThrow("(502)");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("explains rejected keys, unreachable servers, and other errors", async () => {
    await expect(query(provider(new Response("", { status: 401 })).instance, "Q")).rejects.toThrow(
      /rejected the API key \(401\)/,
    );
    const offline = query(provider(new TypeError("fetch failed")).instance, "Q");
    await expect(offline).rejects.toBeInstanceOf(AiUnavailableError);
    await expect(offline).rejects.toThrow(/https:\/\/example\.test\/v1/);
    // Gemini wraps errors in an array.
    const missing = provider(Response.json([{ error: { message: "model gemini-test not found" } }], { status: 404 }));
    await expect(query(missing.instance, "Q")).rejects.toThrow("Gemini returned an error (404): model gemini-test not found");
  });

  it("treats content filtering as a refusal and empty replies as errors", async () => {
    await expect(query(provider(reply(null, "content_filter")).instance, "Q")).rejects.toBeInstanceOf(AiRefusalError);
    await expect(query(provider(reply("")).instance, "Q")).rejects.toBeInstanceOf(AiRequestError);
  });
});

describe("streamed cited answers", () => {
  const sources = [
    { id: "a", title: "Creatine and cognition (Ada Lovelace et al., 2023)", url: null, text: "Abstract A" },
    { id: "b", title: "Second paper", url: null, text: "Abstract B" },
  ];

  it("parses SSE chunks and [n] markers into cited segments", async () => {
    const lines = [delta("Creatine helps [1"), delta("]. Effects "), delta("vary [1, 2]."), "data: [DONE]\n\n"].join("");
    // Split the raw bytes awkwardly to exercise buffering.
    const { instance, body } = provider(sse([lines.slice(0, 15), lines.slice(15, 70), lines.slice(70)]));
    const events: SummaryEvent[] = [];
    const result = await instance.streamCited(
      { system: "Be brief.", history: [{ role: "user", text: "Earlier" }], prompt: "Q?", sources },
      (event) => events.push(event),
    );

    expect(result.segments).toEqual([
      { text: "Creatine helps ", paperIds: ["a"] },
      { text: ". Effects vary ", paperIds: ["a", "b"] },
      { text: ".", paperIds: [] },
    ]);
    expect(result.model).toBe("gemini-test");
    expect(events.filter((e) => e.type === "citation")).toHaveLength(3);
    expect(body(0)).toMatchObject({ stream: true });
    expect(body(0).messages[0].content).toMatch(/^Be brief\.\n\nCite sources by their number/);
    expect(body(0).messages[1]).toEqual({ role: "user", content: "Earlier" });
    expect(body(0).messages[2].content).toContain("[1] Creatine and cognition (Ada Lovelace et al., 2023)\nAbstract A");
    expect(body(0).messages[2].content).toMatch(/Q\?$/);
  });

  it("raises on stream errors, refusals and empty answers", async () => {
    const request = { system: "S", prompt: "Q", sources };
    const errored = provider(sse([`data: ${JSON.stringify({ error: { message: "overloaded" } })}\n\n`]));
    await expect(errored.instance.streamCited(request, () => {})).rejects.toThrow(/overloaded/);
    const filtered = provider(sse([delta("", "content_filter")]));
    await expect(filtered.instance.streamCited(request, () => {})).rejects.toBeInstanceOf(AiRefusalError);
    const empty = provider(sse(["data: [DONE]\n\n"]));
    await expect(empty.instance.streamCited(request, () => {})).rejects.toThrow(/empty answer/);
  });
});

describe("PDFs", () => {
  const lines = [
    "Creatine and Memory in Older Adults: A Randomized Trial",
    "Jane Smith, Ravi Patel",
    "Abstract",
    ...Array.from({ length: 8 }, (_, i) => `Sentence ${i + 1}: forty participants took creatine (5 g/day) for twelve weeks.`),
  ];

  it("extracts text locally", async () => {
    const result = await extractPdfText(makePdf(lines), 100_000);
    expect(result.pages).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.text).toContain("Creatine and Memory in Older Adults");
    expect(result.text).toContain("(5 g/day)");
    const short = await extractPdfText(makePdf(lines), 50);
    expect(short).toMatchObject({ truncated: true });
    expect(short.text).toHaveLength(50);
  });

  it("sends the PDF's extracted text with the prompt", async () => {
    const meta = { title: "Creatine and Memory", authors: ["Jane Smith"], year: 2024, venue: null, doi: null, abstract: "A." };
    const { instance, body } = provider(reply(JSON.stringify(meta)));
    const pdf = makePdf(lines);
    expect(await instance.json(PdfMetadata, { prompt: "Read it.", pdf: { data: pdf, title: "trial.pdf" } })).toEqual(meta);
    const sent = body(0).messages[1].content as string;
    expect(sent).toContain('The attached paper "trial.pdf" (text extracted from the PDF)');
    expect(sent).toContain("Jane Smith, Ravi Patel");
    expect(sent).toMatch(/<\/paper>\n\nRead it\.$/);
  });

  it("explains PDFs without selectable text", async () => {
    const { instance } = provider();
    const read = (data: Uint8Array) => instance.json(PdfMetadata, { prompt: "P", pdf: { data, title: "x.pdf" } });
    await expect(read(makePdf(["Hi"]))).rejects.toThrow(/scanned image/);
    await expect(read(new TextEncoder().encode("%PDF-1.4 broken"))).rejects.toThrow(/Could not read text/);
  });
});

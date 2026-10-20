import "server-only";
import { z } from "zod";
import { applySummaryEvent } from "@/lib/summary-stream";
import type { SummarySegment } from "@/lib/types";
import { CitationStreamParser } from "./citations";
import type { AiConfig } from "./config";
import { AiRateLimitError, AiRefusalError, AiRequestError, AiUnavailableError } from "./errors";
import { pdfTextForModel } from "./pdf";
import type { AiProvider, CitedRequest, JsonRequest, SummaryEvent } from "./provider";
import { RateGate, retryDelayMs } from "./rate-gate";

/** How models without native citations are told to cite. */
export const CITATION_MARKER_RULES =
  "Cite sources by their number in square brackets immediately after the claim they support, like [1] or [2, 5]. " +
  "Only cite the numbered sources you were given. Do not add a reference list.";

/**
 * Talks to any OpenAI-compatible Chat Completions endpoint: Google Gemini,
 * Groq, OpenRouter, Ollama, LM Studio, and others. Uses plain fetch so no
 * provider-specific SDK is needed.
 */

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Attempts per request when rate limited; free tiers need patience. */
const MAX_RATE_LIMIT_ATTEMPTS = 6;
/** Attempts per request on server errors (5xx). */
const MAX_SERVER_ERROR_ATTEMPTS = 3;
const MAX_WAIT_MS = 65_000;
/** Full-text characters sent per PDF (roughly 4 characters per token). */
const DEFAULT_MAX_PDF_CHARS = 60_000;

export interface OpenAiCompatibleOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxPdfChars?: number;
  /** Proactive request cap; defaults to AI_REQUESTS_PER_MINUTE, if set. */
  requestsPerMinute?: number | null;
}

/** Pulls the first JSON object out of a reply that may include fences or reasoning. */
export function extractJson(content: string): unknown {
  const text = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new SyntaxError("No JSON object found in the reply.");
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Drops empty segments left over from parsing. */
function tidySegments(segments: SummarySegment[]): SummarySegment[] {
  return segments.filter((segment) => segment.text.length > 0 || segment.paperIds.length > 0);
}

function errorMessage(body: unknown): string | undefined {
  const entry = Array.isArray(body) ? body[0] : body;
  if (entry && typeof entry === "object" && "error" in entry) {
    const error = (entry as { error: unknown }).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  }
  return undefined;
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly label: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxPdfChars: number;
  private readonly gate: RateGate;

  constructor(config: Pick<AiConfig, "label" | "model" | "baseUrl" | "apiKey">, options: OpenAiCompatibleOptions = {}) {
    if (!config.baseUrl) throw new AiUnavailableError("No base URL configured for the AI provider.");
    this.label = config.label;
    this.model = config.model;
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.maxPdfChars = options.maxPdfChars ?? (Number(process.env.AI_MAX_PDF_CHARS) || DEFAULT_MAX_PDF_CHARS);
    const perMinute = options.requestsPerMinute ?? (Number(process.env.AI_REQUESTS_PER_MINUTE) || null);
    this.gate = new RateGate(perMinute, this.sleep, this.now);
  }

  // ---- HTTP ----------------------------------------------------------------

  /** POSTs to /chat/completions, pacing requests and retrying rate limits and server errors. */
  private async post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      await this.gate.acquire();
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({ model: this.model, ...body }),
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new AiUnavailableError(`Could not reach ${this.label} at ${this.baseUrl}. Is it running and reachable?`);
      }

      if (response.ok) return response;

      const text = await response.text().catch(() => "");
      const limited = response.status === 429;
      if (limited ? attempt < MAX_RATE_LIMIT_ATTEMPTS : response.status >= 500 && attempt < MAX_SERVER_ERROR_ATTEMPTS) {
        const hinted = retryDelayMs(response.headers, text, this.now());
        const wait = Math.min(hinted ?? 2000 * 2 ** (attempt - 1), MAX_WAIT_MS);
        if (limited) {
          // Every queued request waits out the limit, not just this one.
          this.gate.pause(wait + 250);
        } else {
          await this.sleep(wait);
        }
        continue;
      }

      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Not JSON; no detail to show.
      }
      const detail = errorMessage(parsed);
      if (response.status === 401 || response.status === 403) {
        throw new AiUnavailableError(`${this.label} rejected the API key (${response.status}). Check the key in .env.local.`);
      }
      if (response.status === 429) throw new AiRateLimitError(this.label);
      throw new AiRequestError(`${this.label} returned an error (${response.status})${detail ? `: ${detail}` : "."}`);
    }
  }

  private async complete(messages: ChatMessage[], options: { json: boolean }): Promise<string> {
    const body: Record<string, unknown> = { messages, temperature: 0.2 };
    if (options.json) body.response_format = { type: "json_object" };
    let response: Response;
    try {
      response = await this.post(body);
    } catch (error) {
      // Some models reject JSON mode; the prompt already asks for JSON, so retry without it.
      if (!(options.json && error instanceof AiRequestError && /\(400\)/.test(error.message))) throw error;
      delete body.response_format;
      response = await this.post(body);
    }
    const data = (await response.json()) as {
      choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
    };
    const choice = data.choices?.[0];
    if (choice?.finish_reason === "content_filter") throw new AiRefusalError();
    const content = choice?.message?.content;
    if (!content) throw new AiRequestError(`${this.label} returned an empty reply.`);
    return content;
  }

  /** Asks for JSON matching `schema`, validating it and retrying once with the error. */
  private async completeJson<T extends z.ZodType>(schema: T, prompt: string, system?: string): Promise<z.infer<T>> {
    const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          `${system ? `${system}\n\n` : ""}Reply with a single JSON object and nothing else. ` +
          `It must match this JSON Schema:\n${jsonSchema}`,
      },
      { role: "user", content: prompt },
    ];
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const content = await this.complete(messages, { json: true });
      try {
        const parsed = schema.safeParse(extractJson(content));
        if (parsed.success) return parsed.data;
        lastError = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Invalid JSON.";
      }
      messages.push(
        { role: "assistant", content },
        { role: "user", content: `That reply was not valid: ${lastError}. Reply again with only the corrected JSON object.` },
      );
    }
    throw new AiRequestError(`${this.label} did not return valid structured output (${lastError}).`);
  }

  // ---- AiProvider ------------------------------------------------------------

  async streamCited(
    request: CitedRequest,
    onEvent: (event: SummaryEvent) => void,
    signal?: AbortSignal,
  ): Promise<{ segments: SummarySegment[]; model: string }> {
    const sourceIds = request.sources.map((source) => source.id);
    const numbered = request.sources
      .map((source, index) => `[${index + 1}] ${source.title}\n${source.text || "No text available."}`)
      .join("\n\n");
    const response = await this.post(
      {
        stream: true,
        temperature: 0.3,
        messages: [
          { role: "system", content: `${request.system}\n\n${CITATION_MARKER_RULES}` },
          ...(request.history ?? []).map((turn) => ({ role: turn.role, content: turn.text })),
          { role: "user", content: `Sources:\n\n${numbered}\n\n${request.prompt}` },
        ],
      },
      signal,
    );
    if (!response.body) throw new AiRequestError(`${this.label} returned an empty stream.`);

    const parser = new CitationStreamParser(sourceIds);
    let segments: SummarySegment[] = [];
    let refused = false;
    const emit = (events: SummaryEvent[]) => {
      for (const event of events) {
        segments = applySummaryEvent(segments, event);
        onEvent(event);
      }
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let chunk: { choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[]; error?: unknown };
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) throw new AiRequestError(`${this.label} stream error: ${errorMessage(chunk) ?? "unknown"}`);
        const choice = chunk.choices?.[0];
        if (choice?.delta?.content) emit(parser.push(choice.delta.content));
        if (choice?.finish_reason === "content_filter") refused = true;
      }
      if (done) break;
    }
    emit(parser.end());

    segments = tidySegments(segments);
    if (refused && segments.length === 0) throw new AiRefusalError();
    if (segments.length === 0) throw new AiRequestError(`${this.label} returned an empty answer.`);
    return { segments, model: this.model };
  }

  async json<T extends z.ZodType>(schema: T, request: JsonRequest): Promise<z.infer<T>> {
    let prompt = request.prompt;
    if (request.pdf) {
      // This API cannot take PDFs, so send the text extracted from it.
      const { text, truncated } = await pdfTextForModel(request.pdf.data, this.maxPdfChars);
      prompt =
        `The attached paper "${request.pdf.title}" (text extracted from the PDF${truncated ? ", truncated to fit" : ""}):\n` +
        `<paper>\n${text}\n</paper>\n\n${prompt}`;
    }
    return this.completeJson(schema, prompt, request.system);
  }
}

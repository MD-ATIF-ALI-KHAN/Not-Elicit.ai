import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import type { SummarySegment } from "@/lib/types";
import type { AiConfig } from "./config";
import { AiRefusalError, AiUnavailableError } from "./errors";
import type { AiProvider, CitedRequest, CitedSource, JsonRequest, SummaryEvent } from "./provider";

/**
 * All Claude calls go through the beta Messages API so they can opt into
 * server-side refusal fallbacks: if a safety classifier declines a benign
 * request (a false positive), the API re-runs it on Anthropic's recommended
 * fallback model inside the same call instead of failing.
 */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Runs one SDK call. The SDK throws a plain Error (not one of its typed
 * errors) when it cannot resolve credentials before sending a request; turn
 * anything that is not an SDK error into AiUnavailableError so callers can
 * report it clearly.
 */
async function callModel<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Anthropic.AnthropicError) throw error;
    console.error("Claude unavailable:", error instanceof Error ? error.message : error);
    throw new AiUnavailableError(
      "Claude couldn't authenticate. Add ANTHROPIC_API_KEY to .env.local and restart the server.",
    );
  }
}

/** Sources become search_result blocks so Claude returns verified citations. */
export function searchResultBlocks(sources: CitedSource[]): Anthropic.Beta.BetaSearchResultBlockParam[] {
  return sources.map((source) => ({
    type: "search_result",
    source: source.url ?? `not-elicit:source:${source.id}`,
    title: source.title,
    content: [{ type: "text", text: source.text || "No text available." }],
    citations: { enabled: true },
  }));
}

/** Converts the final message's text blocks into segments mapped to source ids. */
export function segmentsFromContent(content: Anthropic.Beta.BetaContentBlock[], sourceIds: string[]): SummarySegment[] {
  const segments: SummarySegment[] = [];
  for (const block of content) {
    if (block.type !== "text") continue;
    const cited: string[] = [];
    for (const citation of block.citations ?? []) {
      if (citation.type !== "search_result_location") continue;
      const id = sourceIds[citation.search_result_index];
      if (id && !cited.includes(id)) cited.push(id);
    }
    const previous = segments.at(-1);
    if (previous && cited.length === 0 && previous.paperIds.length === 0) {
      previous.text += block.text;
    } else {
      segments.push({ text: block.text, paperIds: cited });
    }
  }
  return segments;
}

export class ClaudeProvider implements AiProvider {
  readonly label = "Claude";
  readonly model: string;
  private readonly client: Anthropic;

  constructor(config: Pick<AiConfig, "model" | "apiKey">, client?: Anthropic) {
    this.model = config.model;
    // Without an explicit key the SDK falls back to ANTHROPIC_API_KEY or an
    // `ant auth login` profile.
    this.client = client ?? new Anthropic(config.apiKey ? { apiKey: config.apiKey } : {});
  }

  async streamCited(
    request: CitedRequest,
    onEvent: (event: SummaryEvent) => void,
    signal?: AbortSignal,
  ): Promise<{ segments: SummarySegment[]; model: string }> {
    const sourceIds = request.sources.map((source) => source.id);
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...(request.history ?? []).map((turn) => ({ role: turn.role, content: turn.text })),
      {
        role: "user",
        content: [...searchResultBlocks(request.sources), { type: "text", text: request.prompt }],
      },
    ];
    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: request.system,
        messages,
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "text") {
        onEvent({ type: "segment" });
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          onEvent({ type: "text", text: event.delta.text });
        } else if (event.delta.type === "citations_delta" && event.delta.citation.type === "search_result_location") {
          const id = sourceIds[event.delta.citation.search_result_index];
          if (id) onEvent({ type: "citation", paperId: id });
        }
      }
    }

    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new AiRefusalError();
    return { segments: segmentsFromContent(message.content, sourceIds), model: message.model };
  }

  async json<T extends z.ZodType>(schema: T, request: JsonRequest): Promise<z.infer<T>> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: "text", text: request.prompt }];
    if (request.pdf) {
      content.unshift({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: Buffer.from(request.pdf.data).toString("base64") },
        title: request.pdf.title,
        // Re-extracting new columns from the same PDF reuses the cached document.
        cache_control: { type: "ephemeral" },
      });
    }
    const response = await callModel(() =>
      this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(schema) },
        ...(request.system ? { system: request.system } : {}),
        messages: [{ role: "user", content }],
      }),
    );
    if (response.stop_reason === "refusal") throw new AiRefusalError();
    if (response.parsed_output === null || response.parsed_output === undefined) {
      throw new Error(`Claude returned no structured output (stop_reason: ${response.stop_reason}).`);
    }
    return response.parsed_output as z.infer<T>;
  }
}

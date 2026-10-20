import type { z } from "zod";
import type { SummarySegment, SummaryStreamEvent } from "@/lib/types";

export type SummaryEvent = Extract<SummaryStreamEvent, { type: "segment" | "text" | "citation" }>;

/** Something the model may cite: a paper's abstract or full text. */
export interface CitedSource {
  /** Reported back in citation events. */
  id: string;
  title: string;
  url: string | null;
  text: string;
}

export interface CitedRequest {
  /** Instructions; the provider adds how citations are expressed. */
  system: string;
  /** Earlier conversation turns, oldest first (chat only). */
  history?: { role: "user" | "assistant"; text: string }[];
  /** The current request, sent with the sources. */
  prompt: string;
  sources: CitedSource[];
}

export interface JsonRequest {
  system?: string;
  prompt: string;
  /** A PDF the prompt refers to as "the attached paper". */
  pdf?: { data: Uint8Array; title: string };
}

/**
 * The two capabilities every AI provider offers. Not-Elicit.ai's features
 * (summaries, tables, screening, reports, chat) are built on these.
 */
export interface AiProvider {
  readonly label: string;
  readonly model: string;
  /** Streams an answer that cites `sources`, emitting segment/text/citation events. */
  streamCited(
    request: CitedRequest,
    onEvent: (event: SummaryEvent) => void,
    signal?: AbortSignal,
  ): Promise<{ segments: SummarySegment[]; model: string }>;
  /** Returns output validated against `schema`. */
  json<T extends z.ZodType>(schema: T, request: JsonRequest): Promise<z.infer<T>>;
}

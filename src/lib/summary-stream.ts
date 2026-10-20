// Client-side helpers for the summary endpoint's newline-delimited JSON stream.

import type { Summary, SummarySegment, SummaryStreamEvent } from "@/lib/types";

/** Applies one streamed event to the in-progress summary segments. */
export function applySummaryEvent(segments: SummarySegment[], event: SummaryStreamEvent): SummarySegment[] {
  switch (event.type) {
    case "segment":
      return [...segments, { text: "", paperIds: [] }];
    case "text": {
      if (segments.length === 0) return [{ text: event.text, paperIds: [] }];
      const last = segments[segments.length - 1];
      return [...segments.slice(0, -1), { ...last, text: last.text + event.text }];
    }
    case "citation": {
      if (segments.length === 0) return [{ text: "", paperIds: [event.paperId] }];
      const last = segments[segments.length - 1];
      if (last.paperIds.includes(event.paperId)) return segments;
      return [...segments.slice(0, -1), { ...last, paperIds: [...last.paperIds, event.paperId] }];
    }
    default:
      return segments;
  }
}

/** Reads a newline-delimited JSON body, calling `onEvent` for each line. */
export async function readNdjson<T>(body: ReadableStream<Uint8Array>, onEvent: (event: T) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line) as T);
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as T);
}

/**
 * POSTs to a cited-text endpoint and feeds its events to `onEvent`. Throws
 * with the server's message on failure (HTTP error or a streamed `error`).
 * Resolves with the final result from the `done` event.
 */
export async function postCitedStream(
  url: string,
  init: RequestInit,
  onEvent: (event: SummaryStreamEvent) => void,
): Promise<Summary> {
  const response = await fetch(url, { method: "POST", ...init });
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Something went wrong. Please try again.");
  }
  let result: Summary | null = null;
  await readNdjson<SummaryStreamEvent>(response.body, (event) => {
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "done") result = event.summary;
    onEvent(event);
  });
  if (!result) throw new Error("The response was interrupted. Please try again.");
  return result;
}

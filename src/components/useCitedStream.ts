"use client";

import { useCallback, useState } from "react";
import { applySummaryEvent, postCitedStream } from "@/lib/summary-stream";
import type { ChatSource, Summary, SummarySegment } from "@/lib/types";

export type StreamStatus = "idle" | "streaming" | "error";

/** Runs a cited-text request (summary, report, chat reply), exposing the text as it streams. */
export function useCitedStream() {
  const [draft, setDraft] = useState<SummarySegment[] | null>(null);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (url: string, init: RequestInit = {}, onSources?: (sources: ChatSource[]) => void): Promise<Summary | null> => {
      setStatus("streaming");
      setError(null);
      setDraft([]);
      try {
        const result = await postCitedStream(url, init, (event) => {
          if (event.type === "sources") onSources?.(event.sources);
          else if (event.type !== "done") setDraft((current) => applySummaryEvent(current ?? [], event));
        });
        setDraft(null);
        setStatus("idle");
        return result;
      } catch (e) {
        setDraft(null);
        setStatus("error");
        setError(e instanceof Error ? e.message : "Something went wrong.");
        return null;
      }
    },
    [],
  );

  return { draft, status, error, run };
}

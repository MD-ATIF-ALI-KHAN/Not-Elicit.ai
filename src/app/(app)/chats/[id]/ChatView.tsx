"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CitedText } from "@/components/CitedText";
import { useCitedStream } from "@/components/useCitedStream";
import { formatAuthors, safeUrl } from "@/lib/text";
import type { ChatBundle, ChatMessage, ChatSource } from "@/lib/types";

const SUGGESTIONS = {
  search: [
    "What does the research say about intermittent fasting and longevity?",
    "Is mindfulness meditation effective for reducing anxiety?",
    "What are the main risk factors for long COVID?",
  ],
  papers: [
    "Summarize the main findings of these papers.",
    "How do the study designs and sample sizes compare?",
    "What limitations do these papers share?",
  ],
};

export function ChatView({ initial, ai }: { initial: ChatBundle; ai: { label: string; model: string } | null }) {
  const { chat } = initial;
  const [messages, setMessages] = useState<ChatMessage[]>(initial.messages);
  const [sources, setSources] = useState<ChatSource[]>(initial.sources);
  const [input, setInput] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const stream = useCitedStream();
  const bottom = useRef<HTMLDivElement>(null);
  const streaming = stream.status === "streaming";

  const numberOf = useMemo(() => {
    const map = new Map(sources.map((source) => [source.id, source.position]));
    return (id: string) => map.get(id) ?? null;
  }, [sources]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, stream.draft]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setInput("");
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: "user", text: trimmed, createdAt: Date.now() }]);
    const result = await stream.run(
      `/api/chats/${chat.id}/messages`,
      { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: trimmed }) },
      setSources,
    );
    if (result) {
      setMessages((current) => [
        ...current,
        { id: `local-${Date.now()}-a`, role: "assistant", segments: result.segments, model: result.model, createdAt: result.createdAt },
      ]);
    }
  }

  function cite(sourceId: string) {
    setHighlight(sourceId);
    document.getElementById(`source-${sourceId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-6 py-6 lg:flex-row lg:gap-8">
      <div className="flex min-w-0 flex-1 flex-col">
        <Link href={`/projects/${chat.projectId}`} className="text-sm text-slate-500 hover:text-ink-800">
          ← {initial.projectName}
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-2xl font-semibold text-ink-950">{chat.title}</h1>
          <span className="rounded-full bg-ink-50 px-2.5 py-0.5 text-xs font-medium text-ink-700">
            {chat.mode === "search" ? "Research assistant · finds papers for each question" : `Chat with ${sources.length} papers`}
          </span>
        </div>

        <div className="mt-6 flex-1 space-y-6">
          {messages.length === 0 && !streaming && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <p className="font-serif text-lg text-ink-950">
                {chat.mode === "search"
                  ? "Ask a research question. I'll find relevant papers and answer with citations."
                  : "Ask anything about the selected papers."}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS[chat.mode].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => send(suggestion)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:border-ink-300 hover:text-ink-800"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-ink-800 px-4 py-2.5 text-white">{message.text}</p>
              </div>
            ) : (
              <div key={message.id} className="rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <CitedText segments={message.segments} numberOf={numberOf} onCite={cite} className="font-serif leading-relaxed text-slate-800" />
              </div>
            ),
          )}

          {streaming && (
            <div className="rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-5 py-4 shadow-sm">
              {stream.draft && stream.draft.some((s) => s.text.trim()) ? (
                <CitedText segments={stream.draft} numberOf={numberOf} onCite={cite} streaming className="font-serif leading-relaxed text-slate-800" />
              ) : (
                <p className="animate-pulse text-sm text-slate-500">
                  {chat.mode === "search" ? "Searching papers and reading abstracts…" : "Reading the papers…"}
                </p>
              )}
            </div>
          )}

          {stream.status === "error" && (
            <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
              {stream.error}
            </p>
          )}
          <div ref={bottom} />
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
          className="sticky bottom-0 mt-6 bg-[#fbfaf7] pb-4 pt-2"
        >
          <div className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-ink-400 focus-within:ring-4 focus-within:ring-ink-100">
            <label htmlFor="chat-input" className="sr-only">
              Message
            </label>
            <textarea
              id="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={2}
              maxLength={4000}
              placeholder={chat.mode === "search" ? "Ask a research question…" : "Ask about these papers…"}
              className="max-h-48 min-h-12 flex-1 resize-y bg-transparent px-2 py-1.5 text-slate-900 outline-none placeholder:text-slate-400"
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              className="rounded-xl bg-ink-800 px-5 py-2.5 font-medium text-white hover:bg-ink-900 disabled:opacity-50"
            >
              Send
            </button>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            {ai ? `${ai.label} · ${ai.model}. ` : "No AI model is configured. "}Answers cite the numbered papers on the right; check them before relying on an answer.
          </p>
        </form>
      </div>

      <aside className="mt-8 w-full shrink-0 lg:mt-0 lg:w-80">
        <div className="lg:sticky lg:top-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Sources ({sources.length})</h2>
          {sources.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Papers found for your questions will be listed here.</p>
          ) : (
            <ol className="mt-3 max-h-[75vh] space-y-2 overflow-y-auto pr-1">
              {sources.map((source) => (
                <li
                  key={source.id}
                  id={`source-${source.id}`}
                  className={`rounded-xl border bg-white p-3 text-sm transition ${
                    highlight === source.id ? "border-amber-400 ring-2 ring-amber-200" : "border-slate-200"
                  }`}
                >
                  <div className="flex gap-2">
                    <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-ink-100 px-1 text-[0.7rem] font-semibold text-ink-800">
                      {source.position}
                    </span>
                    <div className="min-w-0">
                      {safeUrl(source.url) ? (
                        <a href={safeUrl(source.url)!} target="_blank" rel="noreferrer" className="font-medium leading-snug text-ink-900 hover:underline">
                          {source.title}
                        </a>
                      ) : (
                        <p className="font-medium leading-snug text-ink-900">{source.title}</p>
                      )}
                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatAuthors(source.authors, 2)}
                        {source.year ? ` · ${source.year}` : ""}
                        {source.hasPdf ? " · full text" : ""}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </main>
  );
}

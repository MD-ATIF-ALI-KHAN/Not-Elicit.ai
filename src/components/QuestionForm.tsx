"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeFilters, FiltersEditor } from "@/components/FiltersEditor";
import type { SearchFilters } from "@/lib/types";

const EXAMPLES = [
  "Does creatine supplementation improve cognition in older adults?",
  "What are the effects of remote work on employee productivity?",
  "How effective is cognitive behavioral therapy for insomnia?",
];

const STAGES = ["Planning a search…", "Searching 250M+ papers…", "Building your table…"];

export function QuestionForm({
  signedIn,
  projects,
  initialProjectId,
  initialQuestion = "",
  showExamples = true,
  autoFocus = false,
  allowFilters = true,
}: {
  signedIn: boolean;
  /** Projects the search can go into; omit to use the default project. */
  projects?: { id: string; name: string }[];
  initialProjectId?: string;
  initialQuestion?: string;
  showExamples?: boolean;
  autoFocus?: boolean;
  allowFilters?: boolean;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState(initialQuestion);
  const [projectId, setProjectId] = useState(initialProjectId ?? projects?.[0]?.id);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [stage, setStage] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (trimmed.length < 5) {
      setError("Please enter a research question of at least 5 characters.");
      return;
    }
    if (!signedIn) {
      router.push(`/signup?next=${encodeURIComponent(`/dashboard?q=${encodeURIComponent(trimmed)}`)}`);
      return;
    }
    setError(null);
    setStage(0);
    const timer = setInterval(() => setStage((s) => (s === null ? s : Math.min(s + 1, STAGES.length - 1))), 2500);
    try {
      const response = await fetch("/api/searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, projectId, filters }),
      });
      const body = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? "Could not start the search.");
      router.push(`/searches/${body.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the search.");
      setStage(null);
    } finally {
      clearInterval(timer);
    }
  }

  const busy = stage !== null;
  const active = describeFilters(filters);

  return (
    <div>
      <form
        onSubmit={submit}
        className="flex flex-col gap-2 rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-ink-400 focus-within:ring-4 focus-within:ring-ink-100 sm:flex-row"
      >
        <label htmlFor="question" className="sr-only">
          Research question
        </label>
        <input
          id="question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a research question…"
          maxLength={500}
          autoFocus={autoFocus}
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent px-3 py-3 text-lg text-slate-900 outline-none placeholder:text-slate-400"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-ink-800 px-6 py-3 font-medium text-white transition hover:bg-ink-900 disabled:opacity-70"
        >
          {busy ? STAGES[stage] : "Search papers"}
        </button>
      </form>

      {signedIn && (projects?.length || allowFilters) && !busy && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-600">
          {projects && projects.length > 0 && (
            <label className="flex items-center gap-2">
              Save to
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-800"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {allowFilters && (
            <button type="button" onClick={() => setShowFilters((s) => !s)} className="font-medium text-ink-700 hover:underline">
              {showFilters ? "Hide filters" : active.length ? `Filters: ${active.join(" · ")}` : "+ Filters"}
            </button>
          )}
        </div>
      )}
      {showFilters && !busy && (
        <div className="mt-3">
          <FiltersEditor value={filters} onChange={setFilters} />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {showExamples && !busy && (
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setQuestion(example)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 transition hover:border-ink-300 hover:text-ink-800"
            >
              {example}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

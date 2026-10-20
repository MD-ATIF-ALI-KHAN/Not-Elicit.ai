"use client";

import { useState } from "react";
import { CitedText } from "@/components/CitedText";
import type { StreamStatus } from "@/components/useCitedStream";
import type { Screening, SummarySegment } from "@/lib/types";

export type Tab = "summary" | "report" | "screening";

interface CitedState {
  segments: SummarySegment[] | null;
  status: StreamStatus;
  error: string | null;
  onGenerate: () => void;
}

function Skeleton({ label }: { label: string }) {
  return (
    <div className="space-y-2" aria-label={label}>
      <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
      <div className="h-4 w-11/12 animate-pulse rounded bg-slate-100" />
      <div className="h-4 w-4/5 animate-pulse rounded bg-slate-100" />
      <p className="pt-1 text-sm text-slate-500">{label}</p>
    </div>
  );
}

function CitedTab({
  state,
  empty,
  loadingLabel,
  numberOf,
  onCite,
  note,
}: {
  state: CitedState;
  empty: React.ReactNode;
  loadingLabel: string;
  numberOf: (id: string) => number | null;
  onCite: (id: string) => void;
  note: string;
}) {
  const streaming = state.status === "streaming";
  const hasText = state.segments?.some((segment) => segment.text.trim());
  return (
    <div>
      {state.status === "error" && state.error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {hasText ? (
        <>
          <CitedText
            segments={state.segments!}
            numberOf={numberOf}
            onCite={onCite}
            streaming={streaming}
            className="font-serif text-[1.05rem] leading-relaxed text-slate-800"
          />
          {!streaming && <p className="mt-4 text-xs text-slate-500">{note}</p>}
        </>
      ) : streaming ? (
        <Skeleton label={loadingLabel} />
      ) : (
        state.status !== "error" && empty
      )}
    </div>
  );
}

export function InsightsPanel({
  tab,
  onTab,
  hasPapers,
  summary,
  report,
  numberOf,
  onCite,
  criteria,
  onSaveCriteria,
  screenings,
  screeningBusy,
  onScreenAll,
  paperCount,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  hasPapers: boolean;
  summary: CitedState;
  report: CitedState;
  numberOf: (id: string) => number | null;
  onCite: (id: string) => void;
  criteria: string[];
  onSaveCriteria: (criteria: string[]) => Promise<void>;
  screenings: Screening[];
  screeningBusy: number;
  onScreenAll: (onlyUnscreened: boolean) => void;
  paperCount: number;
}) {
  const active = tab === "summary" ? summary : tab === "report" ? report : null;
  const tabs: { id: Tab; label: string }[] = [
    { id: "summary", label: "Summary" },
    { id: "report", label: "Report" },
    { id: "screening", label: `Screening${criteria.length ? ` (${screenings.length}/${paperCount})` : ""}` },
  ];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4">
        <div role="tablist" className="flex">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              type="button"
              onClick={() => onTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-3 text-sm font-semibold ${
                tab === t.id ? "border-ink-700 text-ink-900" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {active && hasPapers && (
          <button
            type="button"
            onClick={active.onGenerate}
            disabled={active.status === "streaming"}
            className="rounded-md px-2 py-1 text-sm text-ink-700 hover:bg-ink-50 disabled:opacity-50"
          >
            {active.status === "streaming" ? "Writing…" : active.segments ? "Regenerate" : "Generate"}
          </button>
        )}
      </div>

      <div className="p-6">
        {!hasPapers ? (
          <p className="text-slate-500">No papers yet — try rephrasing your question or upload PDFs.</p>
        ) : tab === "summary" ? (
          <CitedTab
            state={summary}
            empty={<p className="text-slate-500">No summary yet.</p>}
            loadingLabel="Reading the top papers…"
            numberOf={numberOf}
            onCite={onCite}
            note="Based on the abstracts of up to 10 top papers. Numbers refer to rows in the table below."
          />
        ) : tab === "report" ? (
          <CitedTab
            state={report}
            empty={
              <div className="text-slate-600">
                <p>
                  A structured literature-review report: overview, key findings, evidence quality, disagreements, and gaps for
                  future research — with citations.
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  It uses the abstracts and the details extracted in the table (and only screened-in papers, if you screen). Click
                  Generate.
                </p>
              </div>
            }
            loadingLabel="Writing the report…"
            numberOf={numberOf}
            onCite={onCite}
            note="Based on up to 20 papers (screened-in papers when screening has been done) and the details extracted in the table."
          />
        ) : (
          <ScreeningTab
            criteria={criteria}
            onSave={onSaveCriteria}
            screenings={screenings}
            busy={screeningBusy}
            onScreenAll={onScreenAll}
            paperCount={paperCount}
          />
        )}
      </div>
    </section>
  );
}

const EXAMPLE_CRITERIA = [
  "The study is a randomized controlled trial or meta-analysis",
  "Participants are adults (18 years or older)",
  "The study reports a quantitative outcome",
];

function ScreeningTab({
  criteria,
  onSave,
  screenings,
  busy,
  onScreenAll,
  paperCount,
}: {
  criteria: string[];
  onSave: (criteria: string[]) => Promise<void>;
  screenings: Screening[];
  busy: number;
  onScreenAll: (onlyUnscreened: boolean) => void;
  paperCount: number;
}) {
  const [draft, setDraft] = useState<string[]>(criteria.length ? criteria : [""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft.map((c) => c.trim()).filter(Boolean)) !== JSON.stringify(criteria);
  const counts = { include: 0, maybe: 0, exclude: 0 };
  for (const s of screenings) counts[s.decision]++;

  async function save(thenScreen: boolean) {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft.map((c) => c.trim()).filter(Boolean));
      if (thenScreen) onScreenAll(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the criteria.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-slate-600">
        Write inclusion criteria for a systematic review. The AI checks each paper against every criterion and marks it{" "}
        <b className="text-emerald-700">Include</b> (meets all), <b className="text-amber-700">Maybe</b> (unclear) or{" "}
        <b className="text-red-700">Exclude</b> (fails one). You can override any decision in the table.
      </p>
      <ol className="mt-4 space-y-2">
        {draft.map((criterion, index) => (
          <li key={index} className="flex items-center gap-2">
            <span className="w-5 text-right text-sm text-slate-400">{index + 1}.</span>
            <input
              value={criterion}
              onChange={(e) => setDraft((d) => d.map((c, i) => (i === index ? e.target.value : c)))}
              placeholder={EXAMPLE_CRITERIA[index % EXAMPLE_CRITERIA.length]}
              maxLength={300}
              aria-label={`Criterion ${index + 1}`}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-ink-500 focus:ring-2 focus:ring-ink-200"
            />
            <button
              type="button"
              onClick={() => setDraft((d) => (d.length > 1 ? d.filter((_, i) => i !== index) : [""]))}
              aria-label={`Remove criterion ${index + 1}`}
              className="rounded px-2 text-slate-400 hover:bg-red-50 hover:text-red-700"
            >
              ×
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {draft.length < 10 && (
          <button type="button" onClick={() => setDraft((d) => [...d, ""])} className="font-medium text-ink-700 hover:underline">
            + Add criterion
          </button>
        )}
        <span className="flex-1" />
        {dirty && (
          <button
            type="button"
            onClick={() => save(true)}
            disabled={saving || draft.every((c) => !c.trim())}
            className="rounded-lg bg-ink-800 px-4 py-2 font-medium text-white hover:bg-ink-900 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save & screen all papers"}
          </button>
        )}
        {!dirty && criteria.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => onScreenAll(true)}
              disabled={busy > 0 || screenings.length >= paperCount}
              className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Screen unscreened
            </button>
            <button
              type="button"
              onClick={() => onScreenAll(false)}
              disabled={busy > 0}
              className="rounded-lg bg-ink-800 px-4 py-2 font-medium text-white hover:bg-ink-900 disabled:opacity-60"
            >
              Re-screen all
            </button>
          </>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {criteria.length > 0 && (
        <p className="mt-4 text-sm text-slate-600">
          {busy > 0 && <span className="mr-3 animate-pulse">Screening {busy} {busy === 1 ? "paper" : "papers"}…</span>}
          <span className="text-emerald-700">{counts.include} include</span> · <span className="text-amber-700">{counts.maybe} maybe</span> ·{" "}
          <span className="text-red-700">{counts.exclude} exclude</span> · {paperCount - screenings.length} not screened
        </p>
      )}
    </div>
  );
}

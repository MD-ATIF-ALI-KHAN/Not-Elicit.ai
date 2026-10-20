"use client";

import { useEffect, useState } from "react";
import { formatAuthors, NOT_REPORTED, safeUrl } from "@/lib/text";
import type { Cell, ExtractionColumn, Paper, Screening } from "@/lib/types";
import { CellSkeleton, QuoteBadge, quoteStatus } from "./evidence";
import { cellKey } from "./PaperTable";

type TrailKind = "related" | "citing" | "references";

const TRAIL: { kind: TrailKind; label: string }[] = [
  { kind: "related", label: "Related papers" },
  { kind: "citing", label: "Papers citing this" },
  { kind: "references", label: "Its references" },
];

const MET = { yes: "✓", no: "✗", unclear: "?" } as const;

export function PaperDrawer({
  searchId,
  paper,
  number,
  columns,
  cells,
  pending,
  screening,
  saved,
  onToggleSave,
  onRerun,
  onTrail,
  onClose,
}: {
  searchId: string;
  paper: Paper;
  number: number;
  columns: ExtractionColumn[];
  cells: Record<string, Cell>;
  pending: Set<string>;
  screening: Screening | undefined;
  saved: boolean;
  onToggleSave: () => void;
  onRerun: () => void;
  /** Adds connected papers to the table; resolves with how many were added. */
  onTrail: (kind: TrailKind) => Promise<number>;
  onClose: () => void;
}) {
  const [trailBusy, setTrailBusy] = useState<TrailKind | null>(null);
  const [trailNote, setTrailNote] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function trail(kind: TrailKind) {
    setTrailBusy(kind);
    setTrailNote(null);
    try {
      const added = await onTrail(kind);
      setTrailNote(added > 0 ? `Added ${added} ${added === 1 ? "paper" : "papers"} to the table.` : "No new papers found.");
    } catch (e) {
      setTrailNote(e instanceof Error ? e.message : "Could not load papers.");
    } finally {
      setTrailBusy(null);
    }
  }

  const busy = columns.some((column) => pending.has(cellKey(paper.id, column.id)));
  const pdfHref = paper.hasPdf ? `/api/searches/${searchId}/papers/${paper.id}/pdf` : safeUrl(paper.pdfUrl);
  const paperHref = safeUrl(paper.url);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="paper-title">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink-950/30" />
      <aside className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4">
          <p className="text-sm font-semibold text-slate-500">Paper {number}</p>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">
            Close ✕
          </button>
        </div>

        <div className="space-y-6 px-6 py-6">
          <div>
            <h2 id="paper-title" className="font-serif text-2xl font-semibold leading-snug text-ink-950">
              {paper.title}
            </h2>
            <p className="mt-2 text-sm text-slate-600">{formatAuthors(paper.authors, 8)}</p>
            <p className="mt-1 text-sm text-slate-500">
              {[paper.year, paper.venue, paper.citedByCount !== null ? `Cited by ${paper.citedByCount.toLocaleString("en-US")}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <button
                type="button"
                onClick={onToggleSave}
                className={`rounded-md border px-3 py-1.5 ${saved ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-300 text-ink-800 hover:bg-slate-50"}`}
              >
                {saved ? "★ In your library" : "☆ Save to library"}
              </button>
              {paperHref && (
                <a href={paperHref} target="_blank" rel="noreferrer" className="rounded-md border border-slate-300 px-3 py-1.5 text-ink-800 hover:bg-slate-50">
                  Open paper ↗
                </a>
              )}
              {pdfHref && (
                <a href={pdfHref} target="_blank" rel="noreferrer" className="rounded-md border border-slate-300 px-3 py-1.5 text-ink-800 hover:bg-slate-50">
                  {paper.hasPdf ? "View PDF ↗" : "Open-access PDF ↗"}
                </a>
              )}
              {paper.doi && <span className="rounded-md bg-slate-100 px-3 py-1.5 font-mono text-xs leading-5 text-slate-600">doi:{paper.doi}</span>}
            </div>
          </div>

          {paper.externalId?.startsWith("W") && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Citation trail</h3>
              <div className="flex flex-wrap gap-2 text-sm">
                {TRAIL.map((t) => (
                  <button
                    key={t.kind}
                    type="button"
                    onClick={() => trail(t.kind)}
                    disabled={trailBusy !== null}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-ink-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {trailBusy === t.kind ? "Finding…" : `+ ${t.label}`}
                  </button>
                ))}
              </div>
              {trailNote && <p className="mt-2 text-sm text-slate-600">{trailNote}</p>}
            </section>
          )}

          {screening && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Screening: {screening.decision}
                {screening.overridden ? " (set by you)" : ""}
              </h3>
              <ul className="space-y-1.5 text-sm">
                {screening.results.map((result) => (
                  <li key={result.criterion} className="flex gap-2">
                    <span
                      className={`font-bold ${result.met === "yes" ? "text-emerald-600" : result.met === "no" ? "text-red-600" : "text-amber-600"}`}
                    >
                      {MET[result.met]}
                    </span>
                    <span>
                      <span className="font-medium text-slate-800">{result.criterion}</span>
                      <span className="text-slate-600"> — {result.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              {paper.source === "upload" ? "Abstract (read from the PDF)" : "Abstract"}
            </h3>
            <p className="whitespace-pre-line font-serif leading-relaxed text-slate-800">{paper.abstract || "No abstract available."}</p>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Extracted details</h3>
              <button
                type="button"
                onClick={onRerun}
                disabled={busy || columns.length === 0}
                className="rounded-md px-2 py-1 text-sm text-ink-700 hover:bg-ink-50 disabled:opacity-50"
              >
                {busy ? "Extracting…" : "Re-run extraction"}
              </button>
            </div>
            <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {columns.map((column) => {
                const cell = cells[cellKey(paper.id, column.id)];
                return (
                  <div key={column.id} className="px-4 py-3">
                    <dt className="text-sm font-semibold text-ink-900">{column.name}</dt>
                    <dd className="mt-1 text-sm text-slate-700">
                      {pending.has(cellKey(paper.id, column.id)) ? (
                        <CellSkeleton />
                      ) : cell ? (
                        <>
                          <p className={cell.value === NOT_REPORTED ? "text-slate-400" : ""}>{cell.value}</p>
                          {cell.quote && (
                            <blockquote className="mt-2 border-l-2 border-amber-300 pl-3 font-serif italic text-slate-600">
                              “{cell.quote}”
                              <div className="mt-1 not-italic">
                                <QuoteBadge status={quoteStatus(cell, paper)} />
                              </div>
                            </blockquote>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">Not extracted yet.</span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        </div>
      </aside>
    </div>
  );
}

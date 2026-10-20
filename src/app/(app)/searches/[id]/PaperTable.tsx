"use client";

import { formatAuthors, NOT_REPORTED } from "@/lib/text";
import type { Cell, ExtractionColumn, Paper, Screening, ScreeningDecision } from "@/lib/types";
import { CellSkeleton, QuoteBadge, quoteStatus, ScreeningBadge } from "./evidence";

export const cellKey = (paperId: string, columnId: string) => `${paperId}:${columnId}`;

export function PaperTable({
  papers,
  numberOf,
  columns,
  cells,
  pending,
  errors,
  flashPaperId,
  showScreening,
  screenings,
  screeningPending,
  isSaved,
  onToggleSave,
  onOverride,
  onOpenPaper,
  onRetry,
  onDeletePaper,
  onDeleteColumn,
  onAddColumn,
}: {
  /** Rows to show, already sorted and filtered. */
  papers: Paper[];
  /** Each paper's stable number (its row in the unsorted table), used by citations. */
  numberOf: (paperId: string) => number | null;
  columns: ExtractionColumn[];
  cells: Record<string, Cell>;
  pending: Set<string>;
  errors: Record<string, string>;
  flashPaperId: string | null;
  showScreening: boolean;
  screenings: Map<string, Screening>;
  screeningPending: Set<string>;
  isSaved: (paper: Paper) => boolean;
  onToggleSave: (paper: Paper) => void;
  onOverride: (paperId: string, decision: ScreeningDecision) => void;
  onOpenPaper: (paperId: string) => void;
  onRetry: (paperId: string, columnId: string) => void;
  onDeletePaper: (paper: Paper) => void;
  onDeleteColumn: (column: ExtractionColumn) => void;
  onAddColumn: () => void;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <th className="sticky left-0 z-10 w-10 bg-slate-50 px-3 py-3 text-center">#</th>
            <th className="sticky left-10 z-10 min-w-80 bg-slate-50 px-3 py-3">Paper</th>
            {showScreening && <th className="min-w-44 px-3 py-3">Screening</th>}
            {columns.map((column) => (
              <th key={column.id} className="group min-w-56 px-3 py-3 align-top" title={column.instructions || undefined}>
                <div className="flex items-start justify-between gap-2">
                  <span>{column.name}</span>
                  <button
                    type="button"
                    onClick={() => onDeleteColumn(column)}
                    aria-label={`Remove column ${column.name}`}
                    className="rounded px-1 text-slate-400 opacity-0 hover:bg-red-50 hover:text-red-700 focus:opacity-100 group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              </th>
            ))}
            <th className="min-w-40 px-3 py-2">
              <button
                type="button"
                onClick={onAddColumn}
                className="whitespace-nowrap rounded-md border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-semibold normal-case tracking-normal text-ink-700 hover:border-ink-400 hover:bg-ink-50"
              >
                + Add column
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {papers.map((paper) => {
            const saved = isSaved(paper);
            return (
              <tr
                key={paper.id}
                id={`paper-${paper.id}`}
                className={`group/row scroll-mt-24 border-b border-slate-100 align-top last:border-0 hover:bg-slate-50/60 ${
                  flashPaperId === paper.id ? "vs-flash" : ""
                }`}
              >
                <td className="sticky left-0 bg-white px-3 py-4 text-center text-slate-400 group-hover/row:bg-slate-50">
                  <div>{numberOf(paper.id)}</div>
                  <button
                    type="button"
                    onClick={() => onToggleSave(paper)}
                    aria-label={saved ? `Saved to library: ${paper.title}` : `Save to library: ${paper.title}`}
                    title={saved ? "In your library" : "Save to library"}
                    className={`mt-1 text-base leading-none ${saved ? "text-amber-500" : "text-slate-300 hover:text-amber-500"}`}
                  >
                    {saved ? "★" : "☆"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeletePaper(paper)}
                    aria-label={`Remove ${paper.title}`}
                    title="Remove from table"
                    className="mt-1 block w-full rounded px-1 text-slate-300 opacity-0 hover:bg-red-50 hover:text-red-700 focus:opacity-100 group-hover/row:opacity-100"
                  >
                    ×
                  </button>
                </td>
                <td className="sticky left-10 bg-white px-3 py-4 group-hover/row:bg-slate-50">
                  <button
                    type="button"
                    onClick={() => onOpenPaper(paper.id)}
                    className="text-left font-medium leading-snug text-ink-900 hover:underline"
                  >
                    {paper.title}
                  </button>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatAuthors(paper.authors, 2)}
                    {paper.year ? ` · ${paper.year}` : ""}
                    {paper.venue ? ` · ${paper.venue}` : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.7rem]">
                    {paper.hasPdf && <span className="rounded bg-ink-100 px-1.5 py-0.5 font-medium text-ink-800">PDF</span>}
                    {paper.citedByCount !== null && (
                      <span className="text-slate-500">Cited by {paper.citedByCount.toLocaleString("en-US")}</span>
                    )}
                  </div>
                </td>
                {showScreening && (
                  <td className="px-3 py-4">
                    <ScreeningBadge
                      screening={screenings.get(paper.id)}
                      pending={screeningPending.has(paper.id)}
                      onOverride={(decision) => onOverride(paper.id, decision)}
                    />
                  </td>
                )}
                {columns.map((column) => {
                  const key = cellKey(paper.id, column.id);
                  const cell = cells[key];
                  return (
                    <td key={column.id} className="px-3 py-4 text-slate-700">
                      {pending.has(key) ? (
                        <CellSkeleton />
                      ) : errors[key] ? (
                        <div className="text-xs text-red-700">
                          Couldn’t extract.{" "}
                          <button type="button" onClick={() => onRetry(paper.id, column.id)} className="font-medium underline">
                            Retry
                          </button>
                        </div>
                      ) : cell ? (
                        <button type="button" onClick={() => onOpenPaper(paper.id)} className="block w-full text-left">
                          <span className={`line-clamp-5 ${cell.value === NOT_REPORTED ? "text-slate-400" : ""}`}>{cell.value}</span>
                          <span className="mt-1 block">
                            <QuoteBadge status={quoteStatus(cell, paper)} />
                          </span>
                        </button>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  );
                })}
                <td />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

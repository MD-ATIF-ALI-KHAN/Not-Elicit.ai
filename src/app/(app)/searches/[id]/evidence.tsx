"use client";

import { quoteIsInText } from "@/lib/text";
import type { Cell, Paper, Screening, ScreeningDecision } from "@/lib/types";

export type QuoteStatus = "verified" | "pdf" | "unverified" | "none";

/** Whether a cell's supporting quote can be checked against the paper's text. */
export function quoteStatus(cell: Cell | undefined, paper: Paper): QuoteStatus {
  if (!cell?.quote) return "none";
  if (paper.hasPdf) return "pdf";
  return quoteIsInText(cell.quote, paper.abstract) ? "verified" : "unverified";
}

const LABELS: Record<Exclude<QuoteStatus, "none">, { text: string; className: string; title: string }> = {
  verified: {
    text: "✓ Quote verified",
    className: "bg-emerald-50 text-emerald-700",
    title: "This quote appears word-for-word in the paper's abstract.",
  },
  pdf: {
    text: "From full text",
    className: "bg-ink-50 text-ink-700",
    title: "Quoted from the uploaded PDF.",
  },
  unverified: {
    text: "Quote not found",
    className: "bg-amber-50 text-amber-800",
    title: "This quote could not be found word-for-word in the abstract. Check the paper.",
  },
};

export function QuoteBadge({ status }: { status: QuoteStatus }) {
  if (status === "none") return null;
  const label = LABELS[status];
  return (
    <span title={label.title} className={`inline-block rounded px-1.5 py-0.5 text-[0.68rem] font-medium ${label.className}`}>
      {label.text}
    </span>
  );
}

const DECISIONS: Record<ScreeningDecision, { label: string; className: string }> = {
  include: { label: "Include", className: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  maybe: { label: "Maybe", className: "bg-amber-50 text-amber-800 border-amber-200" },
  exclude: { label: "Exclude", className: "bg-red-50 text-red-800 border-red-200" },
};

/** A paper's screening decision, changeable by the user. */
export function ScreeningBadge({
  screening,
  pending,
  onOverride,
}: {
  screening: Screening | undefined;
  pending: boolean;
  onOverride: (decision: ScreeningDecision) => void;
}) {
  if (pending) return <CellSkeleton />;
  if (!screening) return <span className="text-xs text-slate-400">Not screened</span>;
  const style = DECISIONS[screening.decision];
  return (
    <div>
      <select
        value={screening.decision}
        onChange={(e) => onOverride(e.target.value as ScreeningDecision)}
        aria-label="Screening decision"
        title={screening.reason}
        className={`rounded-md border px-1.5 py-0.5 text-xs font-semibold ${style.className}`}
      >
        {(Object.keys(DECISIONS) as ScreeningDecision[]).map((decision) => (
          <option key={decision} value={decision}>
            {DECISIONS[decision].label}
          </option>
        ))}
      </select>
      {screening.overridden && <span className="ml-1 text-[0.65rem] text-slate-400">(you)</span>}
      <p className="mt-1 line-clamp-3 text-xs text-slate-500">{screening.reason}</p>
    </div>
  );
}

export function CellSkeleton() {
  return (
    <div className="space-y-1.5" aria-label="Extracting">
      <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
      <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100" />
    </div>
  );
}

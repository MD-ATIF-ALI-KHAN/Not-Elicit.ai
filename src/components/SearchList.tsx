"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SearchListItem } from "@/lib/types";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export function SearchList({
  searches,
  projectNames,
  empty = "Your research questions will appear here.",
}: {
  searches: SearchListItem[];
  /** Shown next to each search when listing across projects. */
  projectNames?: Record<string, string>;
  empty?: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);

  async function remove(search: SearchListItem) {
    if (!confirm(`Delete “${search.question}”? Its table and uploaded PDFs will be removed.`)) return;
    setDeleting(search.id);
    const response = await fetch(`/api/searches/${search.id}`, { method: "DELETE" });
    setDeleting(null);
    if (response.ok) router.refresh();
    else alert("Could not delete. Please try again.");
  }

  if (searches.length === 0) {
    return <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">{empty}</p>;
  }

  return (
    <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {searches.map((search) => (
        <li key={search.id} className="group flex items-center gap-4 px-5 py-4 hover:bg-slate-50">
          <span aria-hidden className="text-lg">
            {search.kind === "manual" ? "📚" : "🔎"}
          </span>
          <Link href={`/searches/${search.id}`} className="min-w-0 flex-1">
            <p className="truncate font-medium text-ink-900 group-hover:underline">{search.question}</p>
            <p className="mt-0.5 text-sm text-slate-500">
              {projectNames?.[search.projectId] && <>{projectNames[search.projectId]} · </>}
              {search.paperCount} {search.paperCount === 1 ? "paper" : "papers"} · updated {dateFormat.format(search.updatedAt)}
            </p>
          </Link>
          <button
            type="button"
            onClick={() => remove(search)}
            disabled={deleting === search.id}
            className="rounded-md px-2 py-1 text-sm text-slate-400 opacity-0 transition hover:bg-red-50 hover:text-red-700 focus:opacity-100 group-hover:opacity-100 disabled:opacity-50"
          >
            {deleting === search.id ? "Deleting…" : "Delete"}
          </button>
        </li>
      ))}
    </ul>
  );
}

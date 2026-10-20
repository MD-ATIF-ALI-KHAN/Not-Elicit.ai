"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeFilters } from "@/components/FiltersEditor";
import { useCitedStream } from "@/components/useCitedStream";
import { ExtractionQueue, type ExtractionTask } from "@/lib/extraction-queue";
import type {
  Cell,
  ExtractionColumn,
  Paper,
  Screening,
  ScreeningDecision,
  SearchBundle,
  Summary,
} from "@/lib/types";
import { AddColumnDialog } from "./AddColumnDialog";
import { InsightsPanel, type Tab } from "./InsightsPanel";
import { PaperDrawer } from "./PaperDrawer";
import { cellKey, PaperTable } from "./PaperTable";

type Notice = { kind: "error" | "info"; text: string };
type Sort = "relevance" | "newest" | "oldest" | "cited";
type ScreenFilter = "all" | ScreeningDecision | "unscreened";

/** Column id used to run screening through the shared work queue. */
const SCREEN = "__screen";

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

function withKeys(set: Set<string>, keys: string[], add: boolean): Set<string> {
  const next = new Set(set);
  for (const key of keys) {
    if (add) next.add(key);
    else next.delete(key);
  }
  return next;
}

const json = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function Workspace({
  initial,
  initialHasMore,
  project,
  ai,
}: {
  initial: SearchBundle;
  initialHasMore: boolean;
  project: { id: string; name: string };
  /** The configured AI model, or null when none is set up. */
  ai: { label: string; model: string } | null;
}) {
  const router = useRouter();
  const { search } = initial;
  const searchId = search.id;

  const [papers, setPapers] = useState<Paper[]>(initial.papers);
  const [columns, setColumns] = useState<ExtractionColumn[]>(initial.columns);
  const [cells, setCells] = useState<Record<string, Cell>>(() =>
    Object.fromEntries(initial.cells.map((cell) => [cellKey(cell.paperId, cell.columnId), cell])),
  );
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [screenings, setScreenings] = useState<Map<string, Screening>>(
    () => new Map(initial.screenings.map((s) => [s.paperId, s])),
  );
  const [screeningPending, setScreeningPending] = useState<Set<string>>(() => new Set());
  const [criteria, setCriteria] = useState<string[]>(search.criteria);
  const [savedExternal, setSavedExternal] = useState<Set<string>>(() => new Set(initial.savedExternalIds));
  const [savedUploads, setSavedUploads] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [openPaperId, setOpenPaperId] = useState<string | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [flash, setFlash] = useState<{ paperId: string; at: number } | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("relevance");
  const [screenFilter, setScreenFilter] = useState<ScreenFilter>("all");
  const [startingChat, setStartingChat] = useState(false);

  const [summary, setSummary] = useState<Summary | null>(search.summary);
  const [report, setReport] = useState<Summary | null>(search.report);
  const summaryStream = useCitedStream();
  const reportStream = useCitedStream();

  // ---- Extraction and screening queues --------------------------------------

  const runTask = useCallback(
    async (task: ExtractionTask) => {
      if (task.columnIds.includes(SCREEN)) {
        setScreeningPending((current) => withKeys(current, [task.paperId], true));
        try {
          const response = await fetch(`/api/searches/${searchId}/papers/${task.paperId}/screen`, { method: "POST" });
          if (response.status === 404) return;
          if (!response.ok) throw new Error(await readError(response, "Screening failed."));
          const { screening } = (await response.json()) as { screening: Screening };
          setScreenings((current) => new Map(current).set(screening.paperId, screening));
        } catch (error) {
          setNotice({ kind: "error", text: error instanceof Error ? error.message : "Screening failed." });
        } finally {
          setScreeningPending((current) => withKeys(current, [task.paperId], false));
        }
        return;
      }

      const keys = task.columnIds.map((columnId) => cellKey(task.paperId, columnId));
      setPending((current) => withKeys(current, keys, true));
      setCellErrors((current) => {
        const next = { ...current };
        for (const key of keys) delete next[key];
        return next;
      });
      try {
        const response = await fetch(`/api/searches/${searchId}/papers/${task.paperId}/extract`, {
          method: "POST",
          ...json({ columnIds: task.columnIds }),
        });
        // The paper or column was removed while this was waiting.
        if (response.status === 404) return;
        if (!response.ok) throw new Error(await readError(response, "Extraction failed."));
        const body = (await response.json()) as { cells: Cell[] };
        setCells((current) => {
          const next = { ...current };
          for (const cell of body.cells) next[cellKey(cell.paperId, cell.columnId)] = cell;
          return next;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Extraction failed.";
        setCellErrors((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, message])) }));
        setNotice({ kind: "error", text: message });
      } finally {
        setPending((current) => withKeys(current, keys, false));
      }
    },
    [searchId],
  );

  const [queue] = useState(() => new ExtractionQueue((task) => runTask(task)));
  const [screenQueue] = useState(() => new ExtractionQueue((task) => runTask(task), 2));

  const extractPapers = useCallback(
    (paperIds: string[], columnIds: string[]) => {
      for (const paperId of paperIds) queue.add(paperId, columnIds);
    },
    [queue],
  );

  const screenPapers = useCallback(
    (paperIds: string[]) => {
      for (const paperId of paperIds) screenQueue.add(paperId, [SCREEN]);
    },
    [screenQueue],
  );

  // ---- Summary and report -----------------------------------------------------

  const runSummary = summaryStream.run;
  const generateSummary = useCallback(async () => {
    const result = await runSummary(`/api/searches/${searchId}/summary`);
    if (result) setSummary(result);
  }, [runSummary, searchId]);

  async function generateReport() {
    const result = await reportStream.run(`/api/searches/${searchId}/report`);
    if (result) setReport(result);
  }

  // On first load, fill in whatever this table is missing.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const existing = new Set(initial.cells.map((cell) => cellKey(cell.paperId, cell.columnId)));
    for (const paper of initial.papers) {
      queue.add(
        paper.id,
        initial.columns.filter((column) => !existing.has(cellKey(paper.id, column.id))).map((column) => column.id),
      );
    }
    if (!initial.search.summary && initial.papers.some((paper) => paper.abstract)) {
      // Deferred so the effect itself does not set state synchronously.
      queueMicrotask(() => void generateSummary());
    }
  }, [initial, queue, generateSummary]);

  // ---- Derived views --------------------------------------------------------------

  const numbers = useMemo(() => new Map(papers.map((paper, index) => [paper.id, index + 1])), [papers]);
  const numberOf = useCallback((paperId: string) => numbers.get(paperId) ?? null, [numbers]);

  const visiblePapers = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = papers.filter((paper) => {
      if (q && ![paper.title, paper.authors.join(" "), paper.venue ?? ""].join(" ").toLowerCase().includes(q)) return false;
      if (screenFilter === "all") return true;
      const decision = screenings.get(paper.id)?.decision;
      return screenFilter === "unscreened" ? !decision : decision === screenFilter;
    });
    if (sort !== "relevance") {
      rows = [...rows].sort((a, b) =>
        sort === "cited"
          ? (b.citedByCount ?? -1) - (a.citedByCount ?? -1)
          : sort === "newest"
            ? (b.year ?? 0) - (a.year ?? 0)
            : (a.year ?? 9999) - (b.year ?? 9999),
      );
    }
    return rows;
  }, [papers, query, sort, screenFilter, screenings]);

  function cite(paperId: string) {
    if (!visiblePapers.some((paper) => paper.id === paperId)) {
      setQuery("");
      setScreenFilter("all");
    }
    requestAnimationFrame(() =>
      document.getElementById(`paper-${paperId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
    setFlash({ paperId, at: Date.now() });
  }

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 1700);
    return () => clearTimeout(timer);
  }, [flash]);

  // ---- Actions ----------------------------------------------------------------------

  const isSaved = useCallback(
    (paper: Paper) => (paper.externalId ? savedExternal.has(paper.externalId) : savedUploads.has(paper.id)),
    [savedExternal, savedUploads],
  );

  async function toggleSave(paper: Paper) {
    if (isSaved(paper) && paper.externalId) {
      const response = await fetch("/api/library", { method: "DELETE", ...json({ externalId: paper.externalId }) });
      if (response.ok || response.status === 404) {
        setSavedExternal((current) => withKeys(current, [paper.externalId!], false));
      }
      return;
    }
    if (isSaved(paper)) {
      setNotice({ kind: "info", text: "This uploaded paper is already in your library. Remove it from the Library page." });
      return;
    }
    const response = await fetch("/api/library", { method: "POST", ...json({ searchId, paperId: paper.id }) });
    if (!response.ok) {
      setNotice({ kind: "error", text: await readError(response, "Could not save to your library.") });
      return;
    }
    if (paper.externalId) setSavedExternal((current) => withKeys(current, [paper.externalId!], true));
    else setSavedUploads((current) => withKeys(current, [paper.id], true));
  }

  async function overrideScreening(paperId: string, decision: ScreeningDecision) {
    const response = await fetch(`/api/searches/${searchId}/papers/${paperId}/screen`, { method: "PATCH", ...json({ decision }) });
    if (!response.ok) {
      setNotice({ kind: "error", text: await readError(response, "Could not change the decision.") });
      return;
    }
    const { screening } = (await response.json()) as { screening: Screening };
    setScreenings((current) => new Map(current).set(paperId, screening));
  }

  async function saveCriteria(next: string[]) {
    const response = await fetch(`/api/searches/${searchId}/criteria`, { method: "PUT", ...json({ criteria: next }) });
    if (!response.ok) throw new Error(await readError(response, "Could not save the criteria."));
    setCriteria(next);
  }

  function screenAll(onlyUnscreened: boolean) {
    screenPapers(papers.filter((paper) => !onlyUnscreened || !screenings.has(paper.id)).map((paper) => paper.id));
  }

  async function addColumn(name: string, instructions: string) {
    const response = await fetch(`/api/searches/${searchId}/columns`, { method: "POST", ...json({ name, instructions }) });
    if (!response.ok) throw new Error(await readError(response, "Could not add the column."));
    const { column } = (await response.json()) as { column: ExtractionColumn };
    setColumns((current) => [...current, column]);
    setAddingColumn(false);
    extractPapers(
      papers.map((paper) => paper.id),
      [column.id],
    );
  }

  async function deleteColumn(column: ExtractionColumn) {
    if (!confirm(`Remove the “${column.name}” column?`)) return;
    const response = await fetch(`/api/searches/${searchId}/columns/${column.id}`, { method: "DELETE" });
    if (!response.ok) {
      setNotice({ kind: "error", text: await readError(response, "Could not remove the column.") });
      return;
    }
    queue.removeColumn(column.id);
    setColumns((current) => current.filter((c) => c.id !== column.id));
  }

  async function deletePaper(paper: Paper) {
    if (!confirm(`Remove “${paper.title}” from this table?`)) return;
    const response = await fetch(`/api/searches/${searchId}/papers/${paper.id}`, { method: "DELETE" });
    if (!response.ok) {
      setNotice({ kind: "error", text: await readError(response, "Could not remove the paper.") });
      return;
    }
    queue.removePaper(paper.id);
    screenQueue.removePaper(paper.id);
    setPapers((current) => current.filter((p) => p.id !== paper.id));
    if (openPaperId === paper.id) setOpenPaperId(null);
  }

  /** Adds new papers to the table and fills them in. */
  function adopt(newPapers: Paper[]) {
    setPapers((current) => [...current, ...newPapers]);
    extractPapers(
      newPapers.map((paper) => paper.id),
      columns.map((column) => column.id),
    );
    if (criteria.length > 0) screenPapers(newPapers.map((paper) => paper.id));
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/searches/${searchId}/papers/more`, { method: "POST" });
      if (!response.ok) throw new Error(await readError(response, "Could not load more papers."));
      const body = (await response.json()) as { papers: Paper[]; hasMore: boolean };
      adopt(body.papers);
      setHasMore(body.hasMore);
      if (body.papers.length === 0) setNotice({ kind: "info", text: "No new papers were found on the next page." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not load more papers." });
    } finally {
      setLoadingMore(false);
    }
  }

  async function trail(paperId: string, kind: "related" | "citing" | "references"): Promise<number> {
    const response = await fetch(`/api/searches/${searchId}/papers/${paperId}/trail`, { method: "POST", ...json({ kind }) });
    if (!response.ok) throw new Error(await readError(response, "Could not load papers."));
    const body = (await response.json()) as { papers: Paper[] };
    adopt(body.papers);
    return body.papers.length;
  }

  async function upload(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      setUploading(file.name);
      try {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(`/api/searches/${searchId}/papers/upload`, { method: "POST", body: form });
        if (!response.ok) throw new Error(await readError(response, `Could not add ${file.name}.`));
        const { paper } = (await response.json()) as { paper: Paper };
        adopt([paper]);
        setNotice({ kind: "info", text: `Added “${paper.title}”.` });
      } catch (error) {
        setNotice({ kind: "error", text: error instanceof Error ? error.message : `Could not add ${file.name}.` });
      }
    }
    setUploading(null);
  }

  async function chatWithPapers() {
    setStartingChat(true);
    const paperIds = visiblePapers.slice(0, 40).map((paper) => paper.id);
    const response = await fetch("/api/chats", {
      method: "POST",
      ...json({ projectId: search.projectId, mode: "papers", search: { id: searchId, paperIds } }),
    });
    if (!response.ok) {
      setNotice({ kind: "error", text: await readError(response, "Could not start a chat.") });
      setStartingChat(false);
      return;
    }
    const { id } = (await response.json()) as { id: string };
    router.push(`/chats/${id}`);
  }

  const openPaper = openPaperId ? papers.find((paper) => paper.id === openPaperId) : undefined;
  const filterChips = describeFilters(search.filters);
  const included = [...screenings.values()].some((s) => s.decision === "include");

  return (
    <main className="mx-auto w-full max-w-[1600px] px-6 py-8">
      <Link href={`/projects/${project.id}`} className="text-sm text-slate-500 hover:text-ink-800">
        ← {project.name}
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-semibold leading-tight text-ink-950">{search.question}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {search.kind === "manual" ? (
              "Built from papers in your library"
            ) : (
              <>
                Searched OpenAlex for <span className="font-medium text-slate-700">“{search.searchQuery}”</span>
                {search.totalResults !== null && ` · ${search.totalResults.toLocaleString("en-US")} matching works`}
                {filterChips.length > 0 && ` · ${filterChips.join(" · ")}`}
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={chatWithPapers}
          disabled={startingChat || papers.length === 0}
          className="rounded-lg bg-ink-800 px-4 py-2 text-sm font-medium text-white hover:bg-ink-900 disabled:opacity-60"
        >
          {startingChat ? "Starting chat…" : "💬 Chat with these papers"}
        </button>
      </div>

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`mt-4 flex items-start justify-between gap-4 rounded-lg px-4 py-3 text-sm ${
            notice.kind === "error" ? "bg-red-50 text-red-800" : "bg-ink-50 text-ink-800"
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      <div className="mt-6 max-w-4xl">
        <InsightsPanel
          tab={tab}
          onTab={setTab}
          hasPapers={papers.some((paper) => paper.abstract)}
          summary={{
            segments: summaryStream.draft ?? summary?.segments ?? null,
            status: summaryStream.status,
            error: summaryStream.error,
            onGenerate: () => void generateSummary(),
          }}
          report={{
            segments: reportStream.draft ?? report?.segments ?? null,
            status: reportStream.status,
            error: reportStream.error,
            onGenerate: () => void generateReport(),
          }}
          numberOf={numberOf}
          onCite={cite}
          criteria={criteria}
          onSaveCriteria={saveCriteria}
          screenings={[...screenings.values()].filter((s) => numbers.has(s.paperId))}
          screeningBusy={screeningPending.size}
          onScreenAll={screenAll}
          paperCount={papers.length}
        />
      </div>

      <div className="mb-3 mt-10 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold text-ink-950">Papers</h2>
          <p className="text-sm text-slate-500">
            {visiblePapers.length === papers.length ? papers.length : `${visiblePapers.length} of ${papers.length}`}{" "}
            {papers.length === 1 ? "paper" : "papers"}
            {pending.size > 0 && " · extracting details…"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter papers…"
            aria-label="Filter papers"
            className="w-44 rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-ink-500 focus:ring-2 focus:ring-ink-200"
          />
          {criteria.length > 0 && (
            <select
              value={screenFilter}
              onChange={(e) => setScreenFilter(e.target.value as ScreenFilter)}
              aria-label="Filter by screening decision"
              className="rounded-lg border border-slate-300 bg-white px-2 py-2"
            >
              <option value="all">All decisions</option>
              <option value="include">Included</option>
              <option value="maybe">Maybe</option>
              <option value="exclude">Excluded</option>
              <option value="unscreened">Not screened</option>
            </select>
          )}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Sort papers"
            className="rounded-lg border border-slate-300 bg-white px-2 py-2"
          >
            <option value="relevance">Sort: relevance</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="cited">Most cited</option>
          </select>
          <label
            className={`cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50 ${
              uploading ? "pointer-events-none opacity-60" : ""
            }`}
          >
            {uploading ? `Reading ${uploading}…` : "Upload PDFs"}
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="sr-only"
              disabled={Boolean(uploading)}
              onChange={(event) => {
                void upload(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50">
              Export ▾
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              {[
                ["csv", "Table as CSV (Excel)"],
                ["bibtex", "BibTeX (.bib)"],
                ["ris", "RIS (EndNote, Zotero)"],
              ].map(([format, label]) => (
                <a key={format} href={`/api/searches/${searchId}/export?format=${format}`} className="block rounded px-3 py-2 hover:bg-slate-50">
                  {label}
                </a>
              ))}
              {included && (
                <a href={`/api/searches/${searchId}/export?format=csv&included=1`} className="block rounded px-3 py-2 hover:bg-slate-50">
                  Included papers only (CSV)
                </a>
              )}
            </div>
          </details>
        </div>
      </div>

      {papers.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          No papers matched this search. Try a broader question or fewer filters, or upload PDFs you already have.
        </p>
      ) : (
        <PaperTable
          papers={visiblePapers}
          numberOf={numberOf}
          columns={columns}
          cells={cells}
          pending={pending}
          errors={cellErrors}
          flashPaperId={flash?.paperId ?? null}
          showScreening={criteria.length > 0}
          screenings={screenings}
          screeningPending={screeningPending}
          isSaved={isSaved}
          onToggleSave={toggleSave}
          onOverride={overrideScreening}
          onOpenPaper={setOpenPaperId}
          onRetry={(paperId, columnId) => queue.add(paperId, [columnId])}
          onDeletePaper={deletePaper}
          onDeleteColumn={deleteColumn}
          onAddColumn={() => setAddingColumn(true)}
        />
      )}

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 font-medium text-ink-800 hover:bg-slate-50 disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load more papers"}
          </button>
        </div>
      )}

      <p className="mt-8 text-xs text-slate-500">
        {ai ? (
          <>
            AI model: {ai.label} · <span className="font-mono">{ai.model}</span>.{" "}
          </>
        ) : (
          <>No AI model is configured — see the README to add a free key. </>
        )}
        Table cells are extracted from abstracts (or full text for uploaded PDFs). AI can make mistakes — check the supporting
        quotes and the papers themselves.
      </p>

      {openPaper && (
        <PaperDrawer
          searchId={searchId}
          paper={openPaper}
          number={numbers.get(openPaper.id) ?? 0}
          columns={columns}
          cells={cells}
          pending={pending}
          screening={screenings.get(openPaper.id)}
          saved={isSaved(openPaper)}
          onToggleSave={() => void toggleSave(openPaper)}
          onRerun={() =>
            queue.add(
              openPaper.id,
              columns.map((column) => column.id),
            )
          }
          onTrail={(kind) => trail(openPaper.id, kind)}
          onClose={() => setOpenPaperId(null)}
        />
      )}

      {addingColumn && (
        <AddColumnDialog
          existingNames={columns.map((column) => column.name)}
          onAdd={addColumn}
          onClose={() => setAddingColumn(false)}
        />
      )}
    </main>
  );
}

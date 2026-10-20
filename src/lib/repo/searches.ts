import "server-only";
import { getDb, transaction } from "@/lib/db";
import { newId, now } from "@/lib/ids";
import type { NormalizedWork } from "@/lib/openalex";
import { safeUrl } from "@/lib/text";
import type {
  Cell,
  CriterionResult,
  ExtractionColumn,
  Paper,
  Screening,
  Search,
  SearchBundle,
  SearchFilters,
  SearchKind,
  SearchListItem,
  Summary,
} from "@/lib/types";

export const DEFAULT_COLUMNS: { name: string; instructions: string }[] = [
  {
    name: "Summary",
    instructions: "One or two sentences on what this paper found that is relevant to the research question.",
  },
  {
    name: "Study design",
    instructions: "The type of study, e.g. randomized controlled trial, cohort study, meta-analysis, review, or lab study.",
  },
  {
    name: "Population",
    instructions: "Who or what was studied, including the sample size if reported.",
  },
  {
    name: "Main findings",
    instructions: "The key quantitative or qualitative results, with effect sizes or numbers when reported.",
  },
  {
    name: "Limitations",
    instructions: "Limitations the authors acknowledge or that are evident from the text.",
  },
];

/** A paper to add to a search, from OpenAlex, an upload, or the library. */
export interface PaperInput {
  source: "openalex" | "upload";
  externalId: string | null;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  pdfUrl: string | null;
  abstract: string | null;
  citedByCount: number | null;
  pdfFile: string | null;
}

export function workToPaperInput(work: NormalizedWork): PaperInput {
  return { ...work, source: "openalex", pdfFile: null };
}

interface SearchRow {
  id: string;
  user_id: string;
  project_id: string;
  kind: SearchKind;
  question: string;
  search_query: string;
  filters_json: string;
  criteria_json: string;
  next_page: number;
  total_results: number | null;
  summary_json: string | null;
  report_json: string | null;
  created_at: number;
  updated_at: number;
}

interface PaperRow {
  id: string;
  search_id: string;
  source: "openalex" | "upload";
  external_id: string | null;
  title: string;
  authors_json: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  pdf_url: string | null;
  abstract: string | null;
  cited_by_count: number | null;
  pdf_file: string | null;
  position: number;
}

interface ColumnRow {
  id: string;
  search_id: string;
  name: string;
  instructions: string;
  position: number;
}

function toSearch(row: SearchRow): Search {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    kind: row.kind,
    question: row.question,
    searchQuery: row.search_query,
    filters: JSON.parse(row.filters_json) as SearchFilters,
    criteria: JSON.parse(row.criteria_json) as string[],
    nextPage: row.next_page,
    totalResults: row.total_results,
    summary: row.summary_json ? (JSON.parse(row.summary_json) as Summary) : null,
    report: row.report_json ? (JSON.parse(row.report_json) as Summary) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPaper(row: PaperRow): Paper {
  return {
    id: row.id,
    searchId: row.search_id,
    source: row.source,
    externalId: row.external_id,
    title: row.title,
    authors: JSON.parse(row.authors_json) as string[],
    year: row.year,
    venue: row.venue,
    doi: row.doi,
    url: row.url,
    pdfUrl: row.pdf_url,
    abstract: row.abstract,
    citedByCount: row.cited_by_count,
    hasPdf: Boolean(row.pdf_file),
    position: row.position,
  };
}

function toColumn(row: ColumnRow): ExtractionColumn {
  return { id: row.id, searchId: row.search_id, name: row.name, instructions: row.instructions, position: row.position };
}

function touch(searchId: string): void {
  getDb().prepare("UPDATE searches SET updated_at = ? WHERE id = ?").run(now(), searchId);
}

// ---------------------------------------------------------------------------
// Searches. Every lookup takes the owning user's id so one user can never
// read or change another user's data.

export function listSearches(userId: string, projectId?: string): SearchListItem[] {
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.project_id, s.kind, s.question, s.created_at, s.updated_at,
              (SELECT COUNT(*) FROM papers WHERE search_id = s.id) AS paper_count
       FROM searches s WHERE s.user_id = ? AND (? IS NULL OR s.project_id = ?)
       ORDER BY s.updated_at DESC`,
    )
    .all(userId, projectId ?? null, projectId ?? null) as {
    id: string;
    project_id: string;
    kind: SearchKind;
    question: string;
    created_at: number;
    updated_at: number;
    paper_count: number;
  }[];
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    question: row.question,
    paperCount: row.paper_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getSearch(userId: string, searchId: string): Search | null {
  const row = getDb()
    .prepare("SELECT * FROM searches WHERE id = ? AND user_id = ?")
    .get(searchId, userId) as SearchRow | undefined;
  return row ? toSearch(row) : null;
}

export function createSearch(input: {
  userId: string;
  projectId: string;
  kind?: SearchKind;
  question: string;
  searchQuery: string;
  filters?: SearchFilters;
  papers: PaperInput[];
  totalResults: number | null;
}): string {
  const id = newId();
  const timestamp = now();
  transaction(() => {
    getDb()
      .prepare(
        `INSERT INTO searches (id, user_id, project_id, kind, question, search_query, filters_json, next_page,
                               total_results, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 2, ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.projectId,
        input.kind ?? "search",
        input.question,
        input.searchQuery,
        JSON.stringify(input.filters ?? {}),
        input.totalResults,
        timestamp,
        timestamp,
      );
    DEFAULT_COLUMNS.forEach((column, index) => insertColumn(id, column.name, column.instructions, index));
    insertPapers(id, input.papers);
    getDb().prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(timestamp, input.projectId);
  });
  return id;
}

export function getSearchBundle(userId: string, searchId: string): SearchBundle | null {
  const search = getSearch(userId, searchId);
  if (!search) return null;
  const db = getDb();
  const papers = (
    db.prepare("SELECT * FROM papers WHERE search_id = ? ORDER BY position").all(searchId) as unknown as PaperRow[]
  ).map(toPaper);
  const cells = (
    db
      .prepare(
        `SELECT c.paper_id, c.column_id, c.value, c.quote FROM cells c
         JOIN papers p ON p.id = c.paper_id WHERE p.search_id = ?`,
      )
      .all(searchId) as { paper_id: string; column_id: string; value: string; quote: string }[]
  ).map((row): Cell => ({ paperId: row.paper_id, columnId: row.column_id, value: row.value, quote: row.quote }));
  const savedExternalIds = (
    db
      .prepare(
        `SELECT DISTINCT l.external_id FROM library_items l JOIN papers p ON p.external_id = l.external_id
         WHERE l.user_id = ? AND p.search_id = ?`,
      )
      .all(userId, searchId) as { external_id: string }[]
  ).map((row) => row.external_id);
  return { search, papers, columns: listColumns(searchId), cells, screenings: listScreenings(searchId), savedExternalIds };
}

/** Stored PDF file names belonging to the given searches' papers. */
export function pdfFilesForSearches(searchIds: string[]): string[] {
  if (searchIds.length === 0) return [];
  const placeholders = searchIds.map(() => "?").join(", ");
  return (
    getDb()
      .prepare(`SELECT pdf_file FROM papers WHERE search_id IN (${placeholders}) AND pdf_file IS NOT NULL`)
      .all(...searchIds) as { pdf_file: string }[]
  ).map((row) => row.pdf_file);
}

/** Deletes the search and returns the stored PDF file names it owned. */
export function deleteSearch(userId: string, searchId: string): string[] | null {
  if (!getSearch(userId, searchId)) return null;
  const files = pdfFilesForSearches([searchId]);
  getDb().prepare("DELETE FROM searches WHERE id = ?").run(searchId);
  return files;
}

export function renameSearch(searchId: string, question: string): void {
  getDb().prepare("UPDATE searches SET question = ?, updated_at = ? WHERE id = ?").run(question, now(), searchId);
}

export function saveSummary(searchId: string, summary: Summary): void {
  getDb().prepare("UPDATE searches SET summary_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(summary), now(), searchId);
}

export function saveReport(searchId: string, report: Summary): void {
  getDb().prepare("UPDATE searches SET report_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(report), now(), searchId);
}

export function saveCriteria(searchId: string, criteria: string[]): void {
  getDb().prepare("UPDATE searches SET criteria_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(criteria), now(), searchId);
}

// ---------------------------------------------------------------------------
// Papers. Callers must have already checked search ownership.

function nextPosition(searchId: string): number {
  const row = getDb()
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM papers WHERE search_id = ?")
    .get(searchId) as { next: number };
  return row.next;
}

/** Inserts papers, skipping ones (by external id) already in the search; returns new ids. */
function insertPapers(searchId: string, papers: PaperInput[]): string[] {
  const insert = getDb().prepare(
    `INSERT OR IGNORE INTO papers
       (id, search_id, source, external_id, title, authors_json, year, venue, doi, url, pdf_url, abstract,
        cited_by_count, pdf_file, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let position = nextPosition(searchId);
  const inserted: string[] = [];
  for (const paper of papers) {
    const id = newId();
    const result = insert.run(
      id,
      searchId,
      paper.source,
      paper.externalId,
      paper.title,
      JSON.stringify(paper.authors),
      paper.year,
      paper.venue,
      paper.doi,
      safeUrl(paper.url) ?? (paper.doi ? `https://doi.org/${paper.doi}` : null),
      safeUrl(paper.pdfUrl),
      paper.abstract,
      paper.citedByCount,
      paper.pdfFile,
      position,
      now(),
    );
    if (result.changes > 0) {
      inserted.push(id);
      position++;
    }
  }
  return inserted;
}

/** Adds papers not already in the search; returns the new papers. */
export function addPapers(searchId: string, papers: PaperInput[], nextPage?: number): Paper[] {
  const ids = transaction(() => {
    const inserted = insertPapers(searchId, papers);
    if (nextPage !== undefined) getDb().prepare("UPDATE searches SET next_page = ? WHERE id = ?").run(nextPage, searchId);
    touch(searchId);
    return inserted;
  });
  return ids.map((id) => getPaper(searchId, id)).filter((paper): paper is Paper => paper !== null);
}

export function getPaper(searchId: string, paperId: string): Paper | null {
  const row = getDb()
    .prepare("SELECT * FROM papers WHERE id = ? AND search_id = ?")
    .get(paperId, searchId) as PaperRow | undefined;
  return row ? toPaper(row) : null;
}

export function getPaperPdfFile(searchId: string, paperId: string): string | null {
  const row = getDb()
    .prepare("SELECT pdf_file FROM papers WHERE id = ? AND search_id = ?")
    .get(paperId, searchId) as { pdf_file: string | null } | undefined;
  return row?.pdf_file ?? null;
}

/** Removes the paper; returns its stored PDF file name (if any), or undefined if not found. */
export function deletePaper(searchId: string, paperId: string): string | null | undefined {
  const pdfFile = getPaperPdfFile(searchId, paperId);
  const result = getDb().prepare("DELETE FROM papers WHERE id = ? AND search_id = ?").run(paperId, searchId);
  if (result.changes === 0) return undefined;
  touch(searchId);
  return pdfFile;
}

// ---------------------------------------------------------------------------
// Extraction columns and cells.

function insertColumn(searchId: string, name: string, instructions: string, position: number): ExtractionColumn {
  const column = { id: newId(), searchId, name, instructions, position };
  getDb()
    .prepare(
      "INSERT INTO extraction_columns (id, search_id, name, instructions, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(column.id, searchId, name, instructions, position, now());
  return column;
}

export function listColumns(searchId: string): ExtractionColumn[] {
  return (
    getDb()
      .prepare("SELECT * FROM extraction_columns WHERE search_id = ? ORDER BY position")
      .all(searchId) as unknown as ColumnRow[]
  ).map(toColumn);
}

export function addColumn(searchId: string, name: string, instructions: string): ExtractionColumn {
  const row = getDb()
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM extraction_columns WHERE search_id = ?")
    .get(searchId) as { next: number };
  const column = insertColumn(searchId, name, instructions, row.next);
  touch(searchId);
  return column;
}

export function deleteColumn(searchId: string, columnId: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM extraction_columns WHERE id = ? AND search_id = ?")
    .run(columnId, searchId);
  if (result.changes > 0) touch(searchId);
  return result.changes > 0;
}

export function saveCells(cells: Cell[]): void {
  if (cells.length === 0) return;
  transaction(() => {
    const upsert = getDb().prepare(
      `INSERT INTO cells (paper_id, column_id, value, quote, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (paper_id, column_id) DO UPDATE SET value = excluded.value, quote = excluded.quote,
         updated_at = excluded.updated_at`,
    );
    for (const cell of cells) upsert.run(cell.paperId, cell.columnId, cell.value, cell.quote, now());
  });
}

// ---------------------------------------------------------------------------
// Screening.

export function listScreenings(searchId: string): Screening[] {
  return (
    getDb()
      .prepare(
        `SELECT s.paper_id, s.decision, s.reason, s.results_json, s.overridden FROM screenings s
         JOIN papers p ON p.id = s.paper_id WHERE p.search_id = ?`,
      )
      .all(searchId) as {
      paper_id: string;
      decision: Screening["decision"];
      reason: string;
      results_json: string;
      overridden: number;
    }[]
  ).map((row) => ({
    paperId: row.paper_id,
    decision: row.decision,
    reason: row.reason,
    results: JSON.parse(row.results_json) as CriterionResult[],
    overridden: row.overridden === 1,
  }));
}

export function saveScreening(screening: Screening): void {
  getDb()
    .prepare(
      `INSERT INTO screenings (paper_id, decision, reason, results_json, overridden, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (paper_id) DO UPDATE SET decision = excluded.decision, reason = excluded.reason,
         results_json = excluded.results_json, overridden = excluded.overridden, updated_at = excluded.updated_at`,
    )
    .run(
      screening.paperId,
      screening.decision,
      screening.reason,
      JSON.stringify(screening.results),
      screening.overridden ? 1 : 0,
      now(),
    );
}

export function getScreening(paperId: string): Screening | null {
  const row = getDb()
    .prepare("SELECT paper_id, decision, reason, results_json, overridden FROM screenings WHERE paper_id = ?")
    .get(paperId) as
    | { paper_id: string; decision: Screening["decision"]; reason: string; results_json: string; overridden: number }
    | undefined;
  return row
    ? {
        paperId: row.paper_id,
        decision: row.decision,
        reason: row.reason,
        results: JSON.parse(row.results_json) as CriterionResult[],
        overridden: row.overridden === 1,
      }
    : null;
}

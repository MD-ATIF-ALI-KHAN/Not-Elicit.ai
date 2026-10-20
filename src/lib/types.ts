// Shapes shared by server code and client components. Keep this file free of
// server-only imports.

export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Projects: user-created folders holding searches and chats.

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectListItem extends Project {
  searchCount: number;
  chatCount: number;
}

// ---------------------------------------------------------------------------
// Searches: one research question (or hand-picked set of papers) and its table.

export type SearchKind = "search" | "manual";

export interface SearchFilters {
  yearFrom?: number;
  yearTo?: number;
  minCitations?: number;
  openAccessOnly?: boolean;
  /** OpenAlex work types, e.g. "article", "review", "preprint". */
  types?: string[];
}

export type ScreeningDecision = "include" | "exclude" | "maybe";

export interface Search {
  id: string;
  userId: string;
  projectId: string;
  kind: SearchKind;
  question: string;
  searchQuery: string;
  filters: SearchFilters;
  criteria: string[];
  nextPage: number;
  totalResults: number | null;
  summary: Summary | null;
  report: Summary | null;
  createdAt: number;
  updatedAt: number;
}

export interface SearchListItem {
  id: string;
  projectId: string;
  kind: SearchKind;
  question: string;
  paperCount: number;
  createdAt: number;
  updatedAt: number;
}

export type PaperSource = "openalex" | "upload" | "library";

export interface Paper {
  id: string;
  searchId: string;
  source: PaperSource;
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
  hasPdf: boolean;
  position: number;
}

export interface ExtractionColumn {
  id: string;
  searchId: string;
  name: string;
  instructions: string;
  position: number;
}

export interface Cell {
  paperId: string;
  columnId: string;
  value: string;
  quote: string;
}

export interface CriterionResult {
  criterion: string;
  met: "yes" | "no" | "unclear";
  note: string;
}

export interface Screening {
  paperId: string;
  decision: ScreeningDecision;
  reason: string;
  results: CriterionResult[];
  /** True when the user set the decision by hand. */
  overridden: boolean;
}

export interface SearchBundle {
  search: Search;
  papers: Paper[];
  columns: ExtractionColumn[];
  cells: Cell[];
  screenings: Screening[];
  /** External ids of these papers that are already in the user's library. */
  savedExternalIds: string[];
}

// ---------------------------------------------------------------------------
// Cited text (summaries, reports, chat answers)

/** One run of text, with the sources that back it (in citation order). */
export interface SummarySegment {
  text: string;
  paperIds: string[];
}

export interface Summary {
  segments: SummarySegment[];
  /** Sources that were given to the model, in the order they were numbered. */
  paperIds: string[];
  model: string;
  createdAt: number;
}

/** Events streamed by cited-text endpoints as newline-delimited JSON. */
export type SummaryStreamEvent =
  | { type: "segment" }
  | { type: "text"; text: string }
  | { type: "citation"; paperId: string }
  | { type: "sources"; sources: ChatSource[] }
  | { type: "done"; summary: Summary }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// Library

export interface LibraryItem {
  id: string;
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
  hasPdf: boolean;
  tags: string[];
  notes: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Chats

export type ChatMode = "search" | "papers";

export interface Chat {
  id: string;
  projectId: string;
  title: string;
  mode: ChatMode;
  createdAt: number;
  updatedAt: number;
}

export interface ChatListItem extends Chat {
  messageCount: number;
}

/** A paper the chat can cite; numbered by position (1-based in the UI). */
export interface ChatSource {
  id: string;
  position: number;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  url: string | null;
  hasPdf: boolean;
}

export type ChatMessage =
  | { id: string; role: "user"; text: string; createdAt: number }
  | { id: string; role: "assistant"; segments: SummarySegment[]; model: string; createdAt: number };

export interface ChatBundle {
  chat: Chat;
  projectName: string;
  sources: ChatSource[];
  messages: ChatMessage[];
}

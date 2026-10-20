import type { SearchFilters } from "@/lib/types";
import { safeUrl } from "@/lib/text";

// Client for the OpenAlex works API (https://docs.openalex.org), a free index
// of 250M+ scholarly works. Pure helpers are exported for testing.

const WORKS_URL = "https://api.openalex.org/works";
export const PAGE_SIZE = 12;

const SELECT_FIELDS = [
  "id",
  "doi",
  "display_name",
  "publication_year",
  "authorships",
  "primary_location",
  "best_oa_location",
  "cited_by_count",
  "abstract_inverted_index",
].join(",");

export class OpenAlexError extends Error {}

export interface OpenAlexWork {
  id: string;
  doi?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  authorships?: { author?: { display_name?: string | null } | null }[] | null;
  primary_location?: { landing_page_url?: string | null; source?: { display_name?: string | null } | null } | null;
  best_oa_location?: { pdf_url?: string | null; landing_page_url?: string | null } | null;
  cited_by_count?: number | null;
  abstract_inverted_index?: Record<string, number[]> | null;
}

export interface NormalizedWork {
  externalId: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  pdfUrl: string | null;
  abstract: string | null;
  citedByCount: number | null;
}

export interface SearchPage {
  works: NormalizedWork[];
  totalResults: number;
}

/** OpenAlex ships abstracts as {word: [positions]}; rebuild the plain text. */
export function reconstructAbstract(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word;
  }
  const text = words
    .filter((word) => word !== undefined)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export function normalizeWork(work: OpenAlexWork): NormalizedWork {
  const doi = work.doi ? work.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") : null;
  const abstract = reconstructAbstract(work.abstract_inverted_index);
  return {
    externalId: work.id.replace("https://openalex.org/", ""),
    title: stripTags(work.display_name ?? "") || "Untitled",
    authors: (work.authorships ?? [])
      .map((a) => a.author?.display_name?.trim())
      .filter((name): name is string => Boolean(name)),
    year: work.publication_year ?? null,
    venue: work.primary_location?.source?.display_name ?? null,
    doi,
    url: safeUrl(work.primary_location?.landing_page_url) ?? (doi ? `https://doi.org/${doi}` : work.id),
    pdfUrl: safeUrl(work.best_oa_location?.pdf_url),
    abstract: abstract ? stripTags(abstract) : null,
    citedByCount: work.cited_by_count ?? null,
  };
}

/**
 * OpenAlex treats `?` and `*` as wildcards and rejects them in stemmed search,
 * so a question ending in "?" would fail. Strip them before searching.
 */
export function sanitizeQuery(query: string): string {
  return query.replace(/[?*]/g, " ").replace(/\s+/g, " ").trim();
}

/** Work types offered as search filters, with labels. */
export const WORK_TYPES: { id: string; label: string }[] = [
  { id: "article", label: "Articles" },
  { id: "review", label: "Reviews" },
  { id: "preprint", label: "Preprints" },
  { id: "book-chapter", label: "Book chapters" },
  { id: "dissertation", label: "Dissertations" },
];

/** OpenAlex `filter` parameter for a search; always requires an abstract. */
export function buildFilter(filters: SearchFilters = {}): string {
  const parts = ["has_abstract:true", "is_retracted:false"];
  const { yearFrom, yearTo, minCitations, openAccessOnly, types } = filters;
  if (yearFrom && yearTo) parts.push(`publication_year:${yearFrom}-${yearTo}`);
  else if (yearFrom) parts.push(`publication_year:>${yearFrom - 1}`);
  else if (yearTo) parts.push(`publication_year:<${yearTo + 1}`);
  if (minCitations && minCitations > 0) parts.push(`cited_by_count:>${minCitations - 1}`);
  if (openAccessOnly) parts.push("is_oa:true");
  const known = (types ?? []).filter((type) => WORK_TYPES.some((t) => t.id === type));
  if (known.length > 0) parts.push(`type:${known.join("|")}`);
  return parts.join(",");
}

function credentials(params: URLSearchParams, options: { apiKey?: string; mailto?: string }): void {
  if (options.apiKey) params.set("api_key", options.apiKey);
  if (options.mailto) params.set("mailto", options.mailto);
}

function envCredentials() {
  return { apiKey: process.env.OPENALEX_API_KEY || undefined, mailto: process.env.OPENALEX_MAILTO || undefined };
}

export function buildSearchUrl(
  query: string,
  page: number,
  options: { apiKey?: string; mailto?: string; perPage?: number; filters?: SearchFilters } = {},
): string {
  const params = new URLSearchParams({
    search: sanitizeQuery(query),
    filter: buildFilter(options.filters),
    "per-page": String(options.perPage ?? PAGE_SIZE),
    page: String(page),
    select: SELECT_FIELDS,
  });
  credentials(params, options);
  return `${WORKS_URL}?${params.toString()}`;
}

async function getJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": "Not-Elicit.ai/0.1" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new OpenAlexError("Could not reach the OpenAlex paper index. Check your internet connection.");
  }
  if (response.status === 429) {
    throw new OpenAlexError(
      "The OpenAlex paper index is rate limiting searches. Add a free OPENALEX_API_KEY to .env.local, or try again later.",
    );
  }
  if (response.status === 404) throw new OpenAlexError("That paper was not found in OpenAlex.");
  if (!response.ok) throw new OpenAlexError(`The OpenAlex paper index returned an error (${response.status}).`);
  return (await response.json()) as T;
}

export async function searchWorks(
  query: string,
  page = 1,
  fetchImpl: typeof fetch = fetch,
  filters?: SearchFilters,
): Promise<SearchPage> {
  const body = await getJson<{ meta?: { count?: number }; results?: OpenAlexWork[] }>(
    buildSearchUrl(query, page, { ...envCredentials(), filters }),
    fetchImpl,
  );
  return {
    works: (body.results ?? []).map(normalizeWork),
    totalResults: body.meta?.count ?? 0,
  };
}

export type TrailKind = "related" | "citing" | "references";

const WORK_ID = /^W\d+$/;

/**
 * Papers connected to a work: OpenAlex's related works, papers that cite it,
 * or papers it references. Returns works with abstracts, most-cited first
 * where OpenAlex allows sorting.
 */
export async function citationTrail(
  externalId: string,
  kind: TrailKind,
  limit = 10,
  fetchImpl: typeof fetch = fetch,
): Promise<NormalizedWork[]> {
  if (!WORK_ID.test(externalId)) throw new OpenAlexError("Only papers found through search have a citation trail.");
  const params = new URLSearchParams({ "per-page": String(limit), select: SELECT_FIELDS });
  credentials(params, envCredentials());

  if (kind === "citing" || kind === "references") {
    const relation = kind === "citing" ? "cites" : "cited_by";
    params.set("filter", `${relation}:${externalId},has_abstract:true`);
    params.set("sort", "cited_by_count:desc");
  } else {
    const work = await getJson<{ related_works?: string[] }>(
      `${WORKS_URL}/${externalId}?select=related_works${params.has("api_key") ? `&api_key=${params.get("api_key")}` : ""}`,
      fetchImpl,
    );
    const ids = (work.related_works ?? []).map((id) => id.replace("https://openalex.org/", "")).filter((id) => WORK_ID.test(id));
    if (ids.length === 0) return [];
    params.set("filter", `openalex:${ids.slice(0, 50).join("|")},has_abstract:true`);
  }
  const body = await getJson<{ results?: OpenAlexWork[] }>(`${WORKS_URL}?${params.toString()}`, fetchImpl);
  return (body.results ?? []).map(normalizeWork).slice(0, limit);
}

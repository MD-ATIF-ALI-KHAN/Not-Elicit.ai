import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/openalex-works.json";
import {
  buildFilter,
  buildSearchUrl,
  citationTrail,
  normalizeWork,
  OpenAlexError,
  reconstructAbstract,
  sanitizeQuery,
  searchWorks,
  type OpenAlexWork,
} from "@/lib/openalex";

describe("reconstructAbstract", () => {
  it("rebuilds text from an inverted index, including repeated words", () => {
    expect(reconstructAbstract({ the: [0, 3], cat: [1], sat: [2], mat: [4] })).toBe("the cat sat the mat");
  });

  it("tolerates gaps in positions", () => {
    expect(reconstructAbstract({ alpha: [0], omega: [5] })).toBe("alpha omega");
  });

  it("returns null for missing or empty input", () => {
    expect(reconstructAbstract(null)).toBeNull();
    expect(reconstructAbstract(undefined)).toBeNull();
    expect(reconstructAbstract({})).toBeNull();
  });
});

describe("normalizeWork", () => {
  it("maps a real OpenAlex response", () => {
    const work = normalizeWork(fixture.results[0] as unknown as OpenAlexWork);
    expect(work.externalId).toMatch(/^W\d+$/);
    expect(work.title).toBe("The Potential and Challenges of Creatine Supplementation for Cognition/Memory in Older Adults");
    expect(work.doi).toBe("10.4274/ejgg.galenos.2022.2022-9-9");
    expect(work.authors.length).toBeGreaterThan(0);
    expect(work.year).toBe(2023);
    expect(work.abstract).toBeTruthy();
    expect(work.abstract!.split(" ").length).toBeGreaterThan(30);
    expect(work.url).toContain("doi.org");
  });

  it("handles sparse records and strips markup from titles", () => {
    const work = normalizeWork({
      id: "https://openalex.org/W1",
      display_name: "Effects of <i>Lactobacillus</i> on mood",
      authorships: [{ author: { display_name: " Ada Lovelace " } }, { author: null }],
    });
    expect(work).toMatchObject({
      externalId: "W1",
      title: "Effects of Lactobacillus on mood",
      authors: ["Ada Lovelace"],
      year: null,
      venue: null,
      doi: null,
      abstract: null,
      url: "https://openalex.org/W1",
      pdfUrl: null,
    });
  });

  it("falls back to a DOI link and an Untitled title", () => {
    const work = normalizeWork({ id: "https://openalex.org/W2", doi: "https://doi.org/10.1/abc", display_name: null });
    expect(work.title).toBe("Untitled");
    expect(work.url).toBe("https://doi.org/10.1/abc");
  });
});

describe("buildSearchUrl", () => {
  it("requests works with abstracts and the fields Not-Elicit.ai uses", () => {
    const url = new URL(buildSearchUrl("creatine cognition", 2, { perPage: 5 }));
    expect(url.origin + url.pathname).toBe("https://api.openalex.org/works");
    expect(url.searchParams.get("search")).toBe("creatine cognition");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("per-page")).toBe("5");
    expect(url.searchParams.get("filter")).toContain("has_abstract:true");
    expect(url.searchParams.get("select")).toContain("abstract_inverted_index");
    expect(url.searchParams.has("api_key")).toBe(false);
  });

  it("strips wildcard characters that OpenAlex rejects", () => {
    // OpenAlex returns HTTP 400 for "?" or "*" in a stemmed search.
    expect(sanitizeQuery("Does creatine improve cognition?")).toBe("Does creatine improve cognition");
    expect(sanitizeQuery("gut* microbio?e  and mood")).toBe("gut microbio e and mood");
    const url = new URL(buildSearchUrl("Is sleep important?", 1));
    expect(url.searchParams.get("search")).toBe("Is sleep important");
  });

  it("adds the API key and contact email when configured", () => {
    const url = new URL(buildSearchUrl("q", 1, { apiKey: "k123", mailto: "me@example.com" }));
    expect(url.searchParams.get("api_key")).toBe("k123");
    expect(url.searchParams.get("mailto")).toBe("me@example.com");
  });
});

describe("searchWorks", () => {
  it("normalizes results and reports the total", async () => {
    const fetchImpl = vi.fn(async () => Response.json(fixture));
    const page = await searchWorks("creatine", 1, fetchImpl as unknown as typeof fetch);
    expect(page.totalResults).toBe(fixture.meta.count);
    expect(page.works).toHaveLength(fixture.results.length);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("explains rate limiting", async () => {
    const fetchImpl = vi.fn(async () => new Response("slow down", { status: 429 }));
    await expect(searchWorks("q", 1, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/OPENALEX_API_KEY/);
  });

  it("wraps network failures", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(searchWorks("q", 1, fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(OpenAlexError);
  });

  it("reports other HTTP errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 503 }));
    await expect(searchWorks("q", 1, fetchImpl as unknown as typeof fetch)).rejects.toThrow("(503)");
  });
});

describe("buildFilter", () => {
  it("always requires abstracts and excludes retractions", () => {
    expect(buildFilter()).toBe("has_abstract:true,is_retracted:false");
  });

  it("adds year, citation, access and type filters", () => {
    expect(buildFilter({ yearFrom: 2018, yearTo: 2022, minCitations: 10, openAccessOnly: true, types: ["review", "bogus", "article"] })).toBe(
      "has_abstract:true,is_retracted:false,publication_year:2018-2022,cited_by_count:>9,is_oa:true,type:review|article",
    );
    expect(buildFilter({ yearFrom: 2020 })).toContain("publication_year:>2019");
    expect(buildFilter({ yearTo: 2010 })).toContain("publication_year:<2011");
  });
});

describe("citationTrail", () => {
  it("asks OpenAlex for citing papers, most cited first", async () => {
    const fetchImpl = vi.fn(async () => Response.json(fixture));
    const works = await citationTrail("W123", "citing", 5, fetchImpl as unknown as typeof fetch);
    expect(works).toHaveLength(fixture.results.length);
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.get("filter")).toBe("cites:W123,has_abstract:true");
    expect(url.searchParams.get("sort")).toBe("cited_by_count:desc");
  });

  it("looks up related works by id", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ related_works: ["https://openalex.org/W1", "https://openalex.org/W2"] }))
      .mockResolvedValueOnce(Response.json(fixture));
    await citationTrail("W123", "related", 10, fetchImpl as unknown as typeof fetch);
    const url = new URL((fetchImpl.mock.calls[1] as unknown as [string])[0]);
    expect(url.searchParams.get("filter")).toBe("openalex:W1|W2,has_abstract:true");
  });

  it("rejects ids that are not OpenAlex works", async () => {
    await expect(citationTrail("doi:10.1/x", "references")).rejects.toBeInstanceOf(OpenAlexError);
  });
});

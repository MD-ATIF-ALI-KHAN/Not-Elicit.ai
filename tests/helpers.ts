import { openDatabase, setDbForTesting } from "@/lib/db";
import type { NormalizedWork } from "@/lib/openalex";
import type { Paper } from "@/lib/types";

/** Gives the test a fresh in-memory database. Call from beforeEach. */
export function useFreshDb(): void {
  setDbForTesting(openDatabase(":memory:"));
}

export function work(n: number, overrides: Partial<NormalizedWork> = {}): NormalizedWork {
  return {
    externalId: `W${n}`,
    title: `Paper ${n}`,
    authors: [`Author ${n}`],
    year: 2020 + (n % 5),
    venue: "Journal of Tests",
    doi: `10.1000/${n}`,
    url: `https://doi.org/10.1000/${n}`,
    pdfUrl: null,
    abstract: `Abstract of paper ${n}. Creatine improved memory in ${n * 10} participants.`,
    citedByCount: n,
    ...overrides,
  };
}

export function paper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "paper-1",
    searchId: "search-1",
    source: "openalex",
    externalId: "W1",
    title: "Creatine and cognition",
    authors: ["Ada Lovelace", "Alan Turing", "Grace Hopper"],
    year: 2023,
    venue: "Nutrients",
    doi: "10.1/x",
    url: "https://doi.org/10.1/x",
    pdfUrl: null,
    abstract: "Creatine improved working memory in 40 older adults.",
    citedByCount: 12,
    hasPdf: false,
    position: 0,
    ...overrides,
  };
}

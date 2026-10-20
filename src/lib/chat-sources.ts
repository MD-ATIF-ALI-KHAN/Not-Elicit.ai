import "server-only";
import { pdfTextForChat } from "@/lib/ai";
import { HttpError } from "@/lib/api";
import type { NormalizedWork } from "@/lib/openalex";
import type { SourceInput } from "@/lib/repo/chats";
import { getLibraryItem, getLibraryPdfFile } from "@/lib/repo/library";
import { getSearchBundle } from "@/lib/repo/searches";
import { getPaperPdfFile } from "@/lib/repo/searches";
import { readPdf } from "@/lib/storage";

/** The most sources a chat holds; keeps prompts within free-tier limits. */
export const MAX_CHAT_SOURCES = 40;

async function pdfText(fileName: string | null): Promise<string | null> {
  return fileName ? pdfTextForChat(new Uint8Array(await readPdf(fileName))) : null;
}

/** Sources from a table: the given papers, or the first 15 if none are given. */
export async function sourcesFromSearch(userId: string, searchId: string, paperIds?: string[]): Promise<SourceInput[]> {
  const bundle = getSearchBundle(userId, searchId);
  if (!bundle) throw new HttpError(404, "Search not found.");
  const papers = paperIds ? bundle.papers.filter((paper) => paperIds.includes(paper.id)) : bundle.papers.slice(0, 15);
  return Promise.all(
    papers.map(async (paper) => ({
      externalId: paper.externalId,
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      venue: paper.venue,
      url: paper.url,
      abstract: paper.abstract,
      fullText: await pdfText(getPaperPdfFile(searchId, paper.id)),
    })),
  );
}

export async function sourcesFromLibrary(userId: string, itemIds: string[]): Promise<SourceInput[]> {
  return Promise.all(
    itemIds.map(async (itemId) => {
      const item = getLibraryItem(userId, itemId);
      if (!item) throw new HttpError(404, "One of the selected papers is no longer in your library.");
      return {
        externalId: item.externalId,
        title: item.title,
        authors: item.authors,
        year: item.year,
        venue: item.venue,
        url: item.url,
        abstract: item.abstract,
        fullText: await pdfText(getLibraryPdfFile(userId, itemId)),
      };
    }),
  );
}

export function sourcesFromWorks(works: NormalizedWork[]): SourceInput[] {
  return works.map((work) => ({
    externalId: work.externalId,
    title: work.title,
    authors: work.authors,
    year: work.year,
    venue: work.venue,
    url: work.url,
    abstract: work.abstract,
    fullText: null,
  }));
}

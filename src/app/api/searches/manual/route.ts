import { z } from "zod";
import { HttpError, ownedProject, parseJson, requireApiUser, route } from "@/lib/api";
import { getLibraryItem, getLibraryPdfFile } from "@/lib/repo/library";
import { createSearch, type PaperInput } from "@/lib/repo/searches";
import { copyPdf } from "@/lib/storage";

const CreateManual = z.object({
  projectId: z.string(),
  title: z.string().trim().min(1, "Give the table a title.").max(500),
  libraryItemIds: z.array(z.string()).min(1, "Select at least one paper.").max(100),
});

/** Creates a table from hand-picked library papers (no search query). */
export const POST = route(async (request) => {
  const user = await requireApiUser(request);
  const { projectId, title, libraryItemIds } = await parseJson(request, CreateManual);
  ownedProject(user.id, projectId);

  const papers: PaperInput[] = [];
  for (const itemId of libraryItemIds) {
    const item = getLibraryItem(user.id, itemId);
    if (!item) throw new HttpError(404, "One of the selected papers is no longer in your library.");
    const pdf = getLibraryPdfFile(user.id, itemId);
    papers.push({
      source: pdf ? "upload" : "openalex",
      externalId: item.externalId,
      title: item.title,
      authors: item.authors,
      year: item.year,
      venue: item.venue,
      doi: item.doi,
      url: item.url,
      pdfUrl: item.pdfUrl,
      abstract: item.abstract,
      citedByCount: item.citedByCount,
      // The table gets its own copy so deleting either side keeps the other.
      pdfFile: pdf ? await copyPdf(pdf) : null,
    });
  }

  const id = createSearch({
    userId: user.id,
    projectId,
    kind: "manual",
    question: title,
    searchQuery: "",
    papers,
    totalResults: null,
  });
  return Response.json({ id }, { status: 201 });
});

import { HttpError, ownedSearch, requireApiUser, route } from "@/lib/api";
import { PAGE_SIZE, searchWorks } from "@/lib/openalex";
import { addPapers, workToPaperInput } from "@/lib/repo/searches";

type Ctx = { params: Promise<{ id: string }> };

/** Fetches the next page of search results and adds new papers to the table. */
export const POST = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  const search = ownedSearch(user.id, id);
  if (search.kind !== "search") throw new HttpError(400, "This table was built from your library, not a search.");

  const page = await searchWorks(search.searchQuery, search.nextPage, fetch, search.filters);
  const papers = addPapers(id, page.works.map(workToPaperInput), search.nextPage + 1);
  const hasMore = page.works.length === PAGE_SIZE && search.nextPage * PAGE_SIZE < page.totalResults;
  return Response.json({ papers, hasMore });
});

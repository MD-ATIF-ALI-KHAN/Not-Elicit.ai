import { summarize } from "@/lib/ai";
import { HttpError, ndjsonResponse, requireApiUser, route } from "@/lib/api";
import { getSearchBundle, saveSummary } from "@/lib/repo/searches";

type Ctx = { params: Promise<{ id: string }> };

/** How many of the top papers the summary reads. */
const SUMMARY_PAPER_LIMIT = 10;

/** Streams a cited summary as newline-delimited JSON events, then saves it. */
export const POST = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  const bundle = getSearchBundle(user.id, id);
  if (!bundle) throw new HttpError(404, "Search not found.");

  const papers = bundle.papers.filter((paper) => paper.abstract).slice(0, SUMMARY_PAPER_LIMIT);
  if (papers.length === 0) throw new HttpError(400, "There are no papers with abstracts to summarize yet.");

  return ndjsonResponse(request, async (send, signal) => {
    const summary = await summarize(bundle.search.question, papers, send, signal);
    saveSummary(id, summary);
    send({ type: "done", summary });
  });
});

import { writeReport } from "@/lib/ai";
import { HttpError, ndjsonResponse, requireApiUser, route } from "@/lib/api";
import { getSearchBundle, saveReport } from "@/lib/repo/searches";

type Ctx = { params: Promise<{ id: string }> };

/** Papers a report draws on: the screened-in ones if screening was done, else all. */
const REPORT_PAPER_LIMIT = 20;

/** Streams a structured literature-review report, then saves it. */
export const POST = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  const bundle = getSearchBundle(user.id, id);
  if (!bundle) throw new HttpError(404, "Search not found.");

  const included = new Set(bundle.screenings.filter((s) => s.decision === "include").map((s) => s.paperId));
  const candidates = included.size > 0 ? bundle.papers.filter((paper) => included.has(paper.id)) : bundle.papers;
  const papers = candidates.filter((paper) => paper.abstract).slice(0, REPORT_PAPER_LIMIT);
  if (papers.length === 0) throw new HttpError(400, "There are no papers with abstracts to report on yet.");

  return ndjsonResponse(request, async (send, signal) => {
    const report = await writeReport(
      { question: bundle.search.question, papers, columns: bundle.columns, cells: bundle.cells },
      send,
      signal,
    );
    saveReport(id, report);
    send({ type: "done", summary: report });
  });
});

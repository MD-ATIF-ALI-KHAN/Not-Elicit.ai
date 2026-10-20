import { z } from "zod";
import { HttpError, ownedSearch, parseJson, requireApiUser, route } from "@/lib/api";
import { citationTrail } from "@/lib/openalex";
import { addPapers, getPaper, workToPaperInput } from "@/lib/repo/searches";

type Ctx = { params: Promise<{ id: string; paperId: string }> };

const Trail = z.object({ kind: z.enum(["related", "citing", "references"]) });

/** Adds papers related to, citing, or cited by this paper to the table. */
export const POST = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id, paperId } = await params;
  ownedSearch(user.id, id);
  const paper = getPaper(id, paperId);
  if (!paper) throw new HttpError(404, "Paper not found.");
  if (!paper.externalId) throw new HttpError(400, "Uploaded papers have no citation trail.");

  const { kind } = await parseJson(request, Trail);
  const works = await citationTrail(paper.externalId, kind, 10);
  const papers = addPapers(id, works.map(workToPaperInput));
  return Response.json({ papers, found: works.length });
});

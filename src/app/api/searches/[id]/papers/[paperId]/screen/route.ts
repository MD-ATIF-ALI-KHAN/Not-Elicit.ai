import { z } from "zod";
import { screenPaper } from "@/lib/ai";
import { HttpError, ownedSearch, parseJson, requireApiUser, route } from "@/lib/api";
import { getPaper, getPaperPdfFile, getScreening, saveScreening } from "@/lib/repo/searches";
import { readPdf } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string; paperId: string }> };

/** Screens one paper against the search's inclusion criteria. */
export const POST = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id, paperId } = await params;
  const search = ownedSearch(user.id, id);
  if (search.criteria.length === 0) throw new HttpError(400, "Add at least one inclusion criterion first.");
  const paper = getPaper(id, paperId);
  if (!paper) throw new HttpError(404, "Paper not found.");

  const pdfFile = getPaperPdfFile(id, paperId);
  const pdf = pdfFile ? new Uint8Array(await readPdf(pdfFile)) : undefined;
  const screening = await screenPaper({ question: search.question, paper, criteria: search.criteria, pdf });
  saveScreening(screening);
  return Response.json({ screening });
});

const Override = z.object({ decision: z.enum(["include", "exclude", "maybe"]) });

/** Sets the decision by hand, keeping the AI's per-criterion notes. */
export const PATCH = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id, paperId } = await params;
  ownedSearch(user.id, id);
  if (!getPaper(id, paperId)) throw new HttpError(404, "Paper not found.");
  const { decision } = await parseJson(request, Override);
  const existing = getScreening(paperId);
  const screening = {
    paperId,
    decision,
    reason: existing?.reason ?? "Set by you.",
    results: existing?.results ?? [],
    overridden: true,
  };
  saveScreening(screening);
  return Response.json({ screening });
});

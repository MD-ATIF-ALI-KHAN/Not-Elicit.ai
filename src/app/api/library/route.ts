import { z } from "zod";
import { HttpError, ownedSearch, parseJson, requireApiUser, route } from "@/lib/api";
import { addToLibrary, removeByExternalId } from "@/lib/repo/library";
import { getPaper, getPaperPdfFile } from "@/lib/repo/searches";
import { copyPdf, deletePdfs } from "@/lib/storage";

const Save = z.object({ searchId: z.string(), paperId: z.string() });

/** Saves a paper from a table to the library (with its own copy of any PDF). */
export const POST = route(async (request) => {
  const user = await requireApiUser(request);
  const { searchId, paperId } = await parseJson(request, Save);
  ownedSearch(user.id, searchId);
  const paper = getPaper(searchId, paperId);
  if (!paper) throw new HttpError(404, "Paper not found.");

  const pdf = getPaperPdfFile(searchId, paperId);
  const pdfFile = pdf ? await copyPdf(pdf) : null;
  const { item, created } = addToLibrary(user.id, { ...paper, pdfFile });
  if (!created && pdfFile) await deletePdfs([pdfFile]);
  return Response.json({ item }, { status: created ? 201 : 200 });
});

const Unsave = z.object({ externalId: z.string().min(1) });

/** Removes a paper from the library by its OpenAlex id (the table's star toggle). */
export const DELETE = route(async (request) => {
  const user = await requireApiUser(request);
  const { externalId } = await parseJson(request, Unsave);
  const pdfFile = removeByExternalId(user.id, externalId);
  if (pdfFile === undefined) throw new HttpError(404, "That paper is not in your library.");
  await deletePdfs([pdfFile]);
  return new Response(null, { status: 204 });
});

import { HttpError, ownedSearch, requireApiUser, route } from "@/lib/api";
import { getPaper, getPaperPdfFile } from "@/lib/repo/searches";
import { pdfResponse } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string; paperId: string }> };

/** Serves an uploaded PDF to its owner. */
export const GET = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id, paperId } = await params;
  ownedSearch(user.id, id);
  const pdfFile = getPaperPdfFile(id, paperId);
  if (!pdfFile) throw new HttpError(404, "This paper has no uploaded PDF.");
  return pdfResponse(pdfFile, getPaper(id, paperId)?.title ?? "paper");
});

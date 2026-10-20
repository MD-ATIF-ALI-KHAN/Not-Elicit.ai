import { HttpError, requireApiUser, route } from "@/lib/api";
import { getLibraryItem, getLibraryPdfFile } from "@/lib/repo/library";
import { pdfResponse } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  const pdfFile = getLibraryPdfFile(user.id, id);
  if (!pdfFile) throw new HttpError(404, "This paper has no PDF.");
  return pdfResponse(pdfFile, getLibraryItem(user.id, id)?.title ?? "paper");
});

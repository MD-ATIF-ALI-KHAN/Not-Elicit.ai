import { HttpError, ownedSearch, requireApiUser, route } from "@/lib/api";
import { deletePaper } from "@/lib/repo/searches";
import { deletePdfs } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string; paperId: string }> };

export const DELETE = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id, paperId } = await params;
  ownedSearch(user.id, id);
  const pdfFile = deletePaper(id, paperId);
  if (pdfFile === undefined) throw new HttpError(404, "Paper not found.");
  await deletePdfs([pdfFile]);
  return new Response(null, { status: 204 });
});

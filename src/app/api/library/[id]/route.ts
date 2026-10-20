import { z } from "zod";
import { HttpError, parseJson, requireApiUser, route } from "@/lib/api";
import { deleteLibraryItem, updateLibraryItem } from "@/lib/repo/library";
import { deletePdfs } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

const Update = z.object({
  tags: z.array(z.string().max(40)).max(20).optional(),
  notes: z.string().max(10000).optional(),
});

export const PATCH = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  const item = updateLibraryItem(user.id, id, await parseJson(request, Update));
  if (!item) throw new HttpError(404, "Library item not found.");
  return Response.json({ item });
});

export const DELETE = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  const pdfFile = deleteLibraryItem(user.id, id);
  if (pdfFile === undefined) throw new HttpError(404, "Library item not found.");
  await deletePdfs([pdfFile]);
  return new Response(null, { status: 204 });
});

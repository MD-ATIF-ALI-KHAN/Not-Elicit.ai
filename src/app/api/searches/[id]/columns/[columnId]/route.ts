import { HttpError, ownedSearch, requireApiUser, route } from "@/lib/api";
import { deleteColumn } from "@/lib/repo/searches";

type Ctx = { params: Promise<{ id: string; columnId: string }> };

export const DELETE = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id, columnId } = await params;
  ownedSearch(user.id, id);
  if (!deleteColumn(id, columnId)) throw new HttpError(404, "Column not found.");
  return new Response(null, { status: 204 });
});

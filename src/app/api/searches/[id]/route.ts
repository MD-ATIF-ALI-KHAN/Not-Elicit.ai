import { z } from "zod";
import { HttpError, ownedSearch, parseJson, requireApiUser, route } from "@/lib/api";
import { deleteSearch, getSearchBundle, renameSearch } from "@/lib/repo/searches";
import { deletePdfs } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  const bundle = getSearchBundle(user.id, id);
  if (!bundle) throw new HttpError(404, "Search not found.");
  return Response.json(bundle);
});

const Rename = z.object({ question: z.string().trim().min(1).max(500) });

export const PATCH = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  ownedSearch(user.id, id);
  renameSearch(id, (await parseJson(request, Rename)).question);
  return new Response(null, { status: 204 });
});

export const DELETE = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  const files = deleteSearch(user.id, id);
  if (files === null) throw new HttpError(404, "Search not found.");
  await deletePdfs(files);
  return new Response(null, { status: 204 });
});

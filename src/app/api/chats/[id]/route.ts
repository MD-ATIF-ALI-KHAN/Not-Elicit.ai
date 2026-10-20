import { z } from "zod";
import { ownedChat, parseJson, requireApiUser, route } from "@/lib/api";
import { deleteChat, renameChat } from "@/lib/repo/chats";

type Ctx = { params: Promise<{ id: string }> };

const Rename = z.object({ title: z.string().trim().min(1).max(120) });

export const PATCH = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  ownedChat(user.id, id);
  renameChat(id, (await parseJson(request, Rename)).title);
  return new Response(null, { status: 204 });
});

export const DELETE = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  ownedChat(user.id, id);
  deleteChat(id);
  return new Response(null, { status: 204 });
});

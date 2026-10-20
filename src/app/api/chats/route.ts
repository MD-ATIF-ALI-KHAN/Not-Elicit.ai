import { z } from "zod";
import { HttpError, ownedProject, parseJson, requireApiUser, route } from "@/lib/api";
import { MAX_CHAT_SOURCES, sourcesFromLibrary, sourcesFromSearch } from "@/lib/chat-sources";
import { createChat, type SourceInput } from "@/lib/repo/chats";

const CreateChat = z.object({
  projectId: z.string(),
  mode: z.enum(["search", "papers"]),
  /** Papers from one table (all of its first 15 papers if paperIds is omitted). */
  search: z.object({ id: z.string(), paperIds: z.array(z.string()).max(MAX_CHAT_SOURCES).optional() }).optional(),
  libraryItemIds: z.array(z.string()).max(MAX_CHAT_SOURCES).optional(),
});

/**
 * Starts a chat. "search" chats find papers themselves on every question;
 * "papers" chats answer only from the papers chosen here.
 */
export const POST = route(async (request) => {
  const user = await requireApiUser(request);
  const input = await parseJson(request, CreateChat);
  ownedProject(user.id, input.projectId);

  let sources: SourceInput[] = [];
  if (input.search) sources = await sourcesFromSearch(user.id, input.search.id, input.search.paperIds);
  if (input.libraryItemIds?.length) sources = [...sources, ...(await sourcesFromLibrary(user.id, input.libraryItemIds))];
  if (input.mode === "papers" && sources.length === 0) throw new HttpError(400, "Choose at least one paper to chat with.");

  const title =
    input.mode === "papers" ? `Chat about ${sources.length} ${sources.length === 1 ? "paper" : "papers"}` : "New research chat";
  const chat = createChat(input.projectId, title, input.mode, sources.slice(0, MAX_CHAT_SOURCES));
  return Response.json({ id: chat.id }, { status: 201 });
});

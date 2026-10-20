import { z } from "zod";
import { chatReply, planSearchQuery, segmentsToMarkedText } from "@/lib/ai";
import { ndjsonResponse, ownedChat, parseJson, requireApiUser, route } from "@/lib/api";
import { MAX_CHAT_SOURCES, sourcesFromWorks } from "@/lib/chat-sources";
import { searchWorks } from "@/lib/openalex";
import {
  addAssistantMessage,
  addSources,
  addUserMessage,
  listMessages,
  listSources,
  renameChat,
  sourcesForModel,
} from "@/lib/repo/chats";

type Ctx = { params: Promise<{ id: string }> };

/** New papers a research chat looks up per question. */
const PAPERS_PER_QUESTION = 6;
/** Earlier turns sent back to the model. */
const HISTORY_TURNS = 10;

const Message = z.object({
  text: z.string().trim().min(1, "Type a message.").max(4000, "Keep messages under 4000 characters."),
});

/**
 * Sends a message and streams the reply. Research chats first search
 * OpenAlex for papers on the question and add them as sources.
 */
export const POST = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  const chat = ownedChat(user.id, id);
  const { text } = await parseJson(request, Message);

  const earlier = listMessages(id);
  addUserMessage(id, text);
  if (earlier.length === 0) renameChat(id, text.length > 70 ? `${text.slice(0, 67)}…` : text);

  return ndjsonResponse(request, async (send, signal) => {
    if (chat.mode === "search" && listSources(id).length < MAX_CHAT_SOURCES) {
      const context = earlier
        .filter((message) => message.role === "user")
        .slice(-2)
        .map((message) => (message.role === "user" ? `- ${message.text}` : ""))
        .join("\n");
      const query = await planSearchQuery(text, context || undefined);
      const page = await searchWorks(query, 1);
      const room = MAX_CHAT_SOURCES - listSources(id).length;
      addSources(id, sourcesFromWorks(page.works.slice(0, Math.min(PAPERS_PER_QUESTION, room))));
      send({ type: "sources", sources: listSources(id) });
    }

    const sources = sourcesForModel(id);
    const positionOf = new Map(sources.map((source) => [source.id, source.position]));
    const history = earlier.slice(-HISTORY_TURNS).map((message) =>
      message.role === "user"
        ? { role: "user" as const, text: message.text }
        : { role: "assistant" as const, text: segmentsToMarkedText(message.segments, (sid) => positionOf.get(sid)) },
    );

    const reply = await chatReply({ history, message: text, sources }, send, signal);
    const saved = addAssistantMessage(id, reply.segments, reply.model);
    send({
      type: "done",
      summary: { segments: reply.segments, paperIds: sources.map((s) => s.id), model: reply.model, createdAt: saved.createdAt },
    });
  });
});

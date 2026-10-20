import "server-only";
import { getDb, transaction } from "@/lib/db";
import { newId, now } from "@/lib/ids";
import { safeUrl } from "@/lib/text";
import type { Chat, ChatBundle, ChatListItem, ChatMessage, ChatMode, ChatSource, SummarySegment } from "@/lib/types";
import { touchProject } from "./projects";

/** A source as given to the model: metadata plus the text it may quote. */
export interface SourceInput {
  externalId: string | null;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  url: string | null;
  abstract: string | null;
  /** Extracted full text of an uploaded PDF, when there is one. */
  fullText: string | null;
}

export interface SourceForModel extends SourceInput {
  id: string;
  position: number;
}

interface ChatRow {
  id: string;
  project_id: string;
  title: string;
  mode: ChatMode;
  created_at: number;
  updated_at: number;
}

interface SourceRow {
  id: string;
  position: number;
  external_id: string | null;
  title: string;
  authors_json: string;
  year: number | null;
  venue: string | null;
  url: string | null;
  abstract: string | null;
  full_text: string | null;
}

function toChat(row: ChatRow): Chat {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    mode: row.mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSource(row: SourceRow): ChatSource {
  return {
    id: row.id,
    position: row.position,
    title: row.title,
    authors: JSON.parse(row.authors_json) as string[],
    year: row.year,
    venue: row.venue,
    url: row.url,
    hasPdf: row.full_text !== null,
  };
}

export function listChats(userId: string, projectId: string): ChatListItem[] {
  const rows = getDb()
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM chat_messages WHERE chat_id = c.id) AS message_count
       FROM chats c JOIN projects p ON p.id = c.project_id
       WHERE p.user_id = ? AND c.project_id = ? ORDER BY c.updated_at DESC`,
    )
    .all(userId, projectId) as unknown as (ChatRow & { message_count: number })[];
  return rows.map((row) => ({ ...toChat(row), messageCount: row.message_count }));
}

export function getChat(userId: string, chatId: string): Chat | null {
  const row = getDb()
    .prepare("SELECT c.* FROM chats c JOIN projects p ON p.id = c.project_id WHERE c.id = ? AND p.user_id = ?")
    .get(chatId, userId) as ChatRow | undefined;
  return row ? toChat(row) : null;
}

export function createChat(projectId: string, title: string, mode: ChatMode, sources: SourceInput[] = []): Chat {
  const timestamp = now();
  const chat: Chat = { id: newId(), projectId, title, mode, createdAt: timestamp, updatedAt: timestamp };
  transaction(() => {
    getDb()
      .prepare("INSERT INTO chats (id, project_id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(chat.id, projectId, title, mode, timestamp, timestamp);
    insertSources(chat.id, sources);
    touchProject(projectId);
  });
  return chat;
}

export function renameChat(chatId: string, title: string): void {
  getDb().prepare("UPDATE chats SET title = ?, updated_at = ? WHERE id = ?").run(title, now(), chatId);
}

export function deleteChat(chatId: string): void {
  getDb().prepare("DELETE FROM chats WHERE id = ?").run(chatId);
}

function insertSources(chatId: string, sources: SourceInput[]): string[] {
  const db = getDb();
  const row = db.prepare("SELECT COALESCE(MAX(position), 0) AS max FROM chat_sources WHERE chat_id = ?").get(chatId) as {
    max: number;
  };
  let position = row.max + 1;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO chat_sources
       (id, chat_id, position, external_id, title, authors_json, year, venue, url, abstract, full_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const added: string[] = [];
  for (const source of sources) {
    const id = newId();
    const result = insert.run(
      id,
      chatId,
      position,
      source.externalId,
      source.title,
      JSON.stringify(source.authors),
      source.year,
      source.venue,
      safeUrl(source.url),
      source.abstract,
      source.fullText,
      now(),
    );
    if (result.changes > 0) {
      added.push(id);
      position++;
    }
  }
  return added;
}

/** Adds sources not already in the chat (by external id); returns their ids. */
export function addSources(chatId: string, sources: SourceInput[]): string[] {
  return transaction(() => insertSources(chatId, sources));
}

export function listSources(chatId: string): ChatSource[] {
  return (
    getDb()
      .prepare("SELECT * FROM chat_sources WHERE chat_id = ? ORDER BY position")
      .all(chatId) as unknown as SourceRow[]
  ).map(toSource);
}

/** Sources with the text the model reads. */
export function sourcesForModel(chatId: string, ids?: string[]): SourceForModel[] {
  const rows = getDb()
    .prepare("SELECT * FROM chat_sources WHERE chat_id = ? ORDER BY position")
    .all(chatId) as unknown as SourceRow[];
  return rows
    .filter((row) => !ids || ids.includes(row.id))
    .map((row) => ({
      id: row.id,
      position: row.position,
      externalId: row.external_id,
      title: row.title,
      authors: JSON.parse(row.authors_json) as string[],
      year: row.year,
      venue: row.venue,
      url: row.url,
      abstract: row.abstract,
      fullText: row.full_text,
    }));
}

export function listMessages(chatId: string): ChatMessage[] {
  const rows = getDb()
    .prepare("SELECT id, role, content_json, created_at FROM chat_messages WHERE chat_id = ? ORDER BY created_at, rowid")
    .all(chatId) as { id: string; role: "user" | "assistant"; content_json: string; created_at: number }[];
  return rows.map((row) => {
    const content = JSON.parse(row.content_json) as { text?: string; segments?: SummarySegment[]; model?: string };
    return row.role === "user"
      ? { id: row.id, role: "user", text: content.text ?? "", createdAt: row.created_at }
      : { id: row.id, role: "assistant", segments: content.segments ?? [], model: content.model ?? "", createdAt: row.created_at };
  });
}

export function addUserMessage(chatId: string, text: string): ChatMessage {
  const message: ChatMessage = { id: newId(), role: "user", text, createdAt: now() };
  getDb()
    .prepare("INSERT INTO chat_messages (id, chat_id, role, content_json, created_at) VALUES (?, ?, 'user', ?, ?)")
    .run(message.id, chatId, JSON.stringify({ text }), message.createdAt);
  getDb().prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(message.createdAt, chatId);
  return message;
}

export function addAssistantMessage(chatId: string, segments: SummarySegment[], model: string): ChatMessage {
  const message: ChatMessage = { id: newId(), role: "assistant", segments, model, createdAt: now() };
  getDb()
    .prepare("INSERT INTO chat_messages (id, chat_id, role, content_json, created_at) VALUES (?, ?, 'assistant', ?, ?)")
    .run(message.id, chatId, JSON.stringify({ segments, model }), message.createdAt);
  getDb().prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(message.createdAt, chatId);
  return message;
}

export function getChatBundle(userId: string, chatId: string): ChatBundle | null {
  const chat = getChat(userId, chatId);
  if (!chat) return null;
  const project = getDb().prepare("SELECT name FROM projects WHERE id = ?").get(chat.projectId) as { name: string };
  return { chat, projectName: project.name, sources: listSources(chatId), messages: listMessages(chatId) };
}

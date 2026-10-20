import "server-only";
import { getDb } from "@/lib/db";
import { newId, now } from "@/lib/ids";
import type { Project, ProjectListItem } from "@/lib/types";
import { pdfFilesForSearches } from "./searches";

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  created_at: number;
  updated_at: number;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProjects(userId: string): ProjectListItem[] {
  const rows = getDb()
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM searches WHERE project_id = p.id) AS search_count,
              (SELECT COUNT(*) FROM chats WHERE project_id = p.id) AS chat_count
       FROM projects p WHERE p.user_id = ? ORDER BY p.updated_at DESC`,
    )
    .all(userId) as unknown as (ProjectRow & { search_count: number; chat_count: number })[];
  return rows.map((row) => ({ ...toProject(row), searchCount: row.search_count, chatCount: row.chat_count }));
}

export function getProject(userId: string, projectId: string): Project | null {
  const row = getDb()
    .prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?")
    .get(projectId, userId) as ProjectRow | undefined;
  return row ? toProject(row) : null;
}

export function createProject(userId: string, name: string, description = ""): Project {
  const timestamp = now();
  const project = { id: newId(), name, description, createdAt: timestamp, updatedAt: timestamp };
  getDb()
    .prepare("INSERT INTO projects (id, user_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(project.id, userId, name, description, timestamp, timestamp);
  return project;
}

export function updateProject(projectId: string, changes: { name?: string; description?: string }): void {
  const db = getDb();
  if (changes.name !== undefined) db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(changes.name, projectId);
  if (changes.description !== undefined) {
    db.prepare("UPDATE projects SET description = ? WHERE id = ?").run(changes.description, projectId);
  }
  touchProject(projectId);
}

export function touchProject(projectId: string): void {
  getDb().prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now(), projectId);
}

/** Deletes the project with its searches and chats; returns PDF files to remove. */
export function deleteProject(userId: string, projectId: string): string[] | null {
  if (!getProject(userId, projectId)) return null;
  const searchIds = (
    getDb().prepare("SELECT id FROM searches WHERE project_id = ?").all(projectId) as { id: string }[]
  ).map((row) => row.id);
  const files = pdfFilesForSearches(searchIds);
  getDb().prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  return files;
}

/** The user's most recently used project, creating "My research" if they have none. */
export function defaultProject(userId: string): Project {
  return listProjects(userId)[0] ?? createProject(userId, "My research");
}

import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Not-Elicit.ai stores everything in one local SQLite file using Node's built-in
 * `node:sqlite` driver, so there is no native module to compile and no separate
 * database server to run.
 */

export function dataDir(): string {
  // Runtime data only; tell the bundler not to trace this path into the build.
  return path.resolve(/*turbopackIgnore: true*/ process.env.NOT_ELICIT_DATA_DIR ?? path.join(process.cwd(), "data"));
}

export function uploadsDir(): string {
  return path.join(dataDir(), "uploads");
}

// Each entry upgrades the schema by one version; never edit a shipped entry,
// append a new one instead.
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    search_query TEXT NOT NULL,
    next_page INTEGER NOT NULL DEFAULT 2,
    total_results INTEGER,
    summary_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX projects_user ON projects(user_id, updated_at DESC);

  CREATE TABLE papers (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('openalex', 'upload')),
    external_id TEXT,
    title TEXT NOT NULL,
    authors_json TEXT NOT NULL DEFAULT '[]',
    year INTEGER,
    venue TEXT,
    doi TEXT,
    url TEXT,
    pdf_url TEXT,
    abstract TEXT,
    cited_by_count INTEGER,
    pdf_file TEXT,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (project_id, external_id)
  );
  CREATE INDEX papers_project ON papers(project_id, position);

  CREATE TABLE extraction_columns (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    instructions TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX columns_project ON extraction_columns(project_id, position);

  CREATE TABLE cells (
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    column_id TEXT NOT NULL REFERENCES extraction_columns(id) ON DELETE CASCADE,
    value TEXT NOT NULL,
    quote TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (paper_id, column_id)
  );
  `,
  // v2: the per-question "projects" become "searches", grouped under
  // user-created projects; adds screening, the library, and chats.
  `
  ALTER TABLE projects RENAME TO searches;
  ALTER TABLE papers RENAME COLUMN project_id TO search_id;
  ALTER TABLE extraction_columns RENAME COLUMN project_id TO search_id;
  DROP INDEX projects_user;
  DROP INDEX papers_project;
  DROP INDEX columns_project;
  CREATE INDEX papers_search ON papers(search_id, position);
  CREATE INDEX columns_search ON extraction_columns(search_id, position);

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX projects_user ON projects(user_id, updated_at DESC);

  ALTER TABLE searches ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
  ALTER TABLE searches ADD COLUMN kind TEXT NOT NULL DEFAULT 'search';
  ALTER TABLE searches ADD COLUMN filters_json TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE searches ADD COLUMN criteria_json TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE searches ADD COLUMN report_json TEXT;

  -- Existing searches move into one "My research" project per user.
  INSERT INTO projects (id, user_id, name, description, created_at, updated_at)
    SELECT lower(hex(randomblob(16))), user_id, 'My research', '', MIN(created_at), MAX(updated_at)
    FROM searches GROUP BY user_id;
  UPDATE searches SET project_id = (SELECT p.id FROM projects p WHERE p.user_id = searches.user_id);
  CREATE INDEX searches_project ON searches(project_id, updated_at DESC);

  CREATE TABLE screenings (
    paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
    decision TEXT NOT NULL CHECK (decision IN ('include', 'exclude', 'maybe')),
    reason TEXT NOT NULL DEFAULT '',
    results_json TEXT NOT NULL DEFAULT '[]',
    overridden INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE library_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    external_id TEXT,
    title TEXT NOT NULL,
    authors_json TEXT NOT NULL DEFAULT '[]',
    year INTEGER,
    venue TEXT,
    doi TEXT,
    url TEXT,
    pdf_url TEXT,
    abstract TEXT,
    cited_by_count INTEGER,
    pdf_file TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    UNIQUE (user_id, external_id)
  );
  CREATE INDEX library_user ON library_items(user_id, created_at DESC);

  CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('search', 'papers')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX chats_project ON chats(project_id, updated_at DESC);

  -- Chats keep their own snapshot of each source (with extracted PDF text),
  -- so deleting a search or library item never breaks a conversation.
  CREATE TABLE chat_sources (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    external_id TEXT,
    title TEXT NOT NULL,
    authors_json TEXT NOT NULL DEFAULT '[]',
    year INTEGER,
    venue TEXT,
    url TEXT,
    abstract TEXT,
    full_text TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (chat_id, external_id)
  );
  CREATE INDEX chat_sources_chat ON chat_sources(chat_id, position);

  CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX chat_messages_chat ON chat_messages(chat_id, created_at);
  `,
];

export function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let version = row.user_version; version < MIGRATIONS.length; version++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return db;
}

// Keep one connection per process, surviving dev-server hot reloads.
const globalForDb = globalThis as unknown as { notElicitDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (!globalForDb.notElicitDb) {
    const file = process.env.NOT_ELICIT_DB ?? path.join(dataDir(), "not-elicit.db");
    globalForDb.notElicitDb = openDatabase(file);
  }
  return globalForDb.notElicitDb;
}

/** Test hook: replace the process-wide connection. */
export function setDbForTesting(db: DatabaseSync | undefined): void {
  globalForDb.notElicitDb = db;
}

export function transaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

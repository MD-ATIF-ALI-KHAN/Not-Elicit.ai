import "server-only";
import { getDb } from "@/lib/db";
import { newId, now } from "@/lib/ids";
import { safeUrl } from "@/lib/text";
import type { LibraryItem } from "@/lib/types";

export interface LibraryInput {
  externalId: string | null;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  pdfUrl: string | null;
  abstract: string | null;
  citedByCount: number | null;
  pdfFile: string | null;
  tags?: string[];
}

interface LibraryRow {
  id: string;
  external_id: string | null;
  title: string;
  authors_json: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  pdf_url: string | null;
  abstract: string | null;
  cited_by_count: number | null;
  pdf_file: string | null;
  tags_json: string;
  notes: string;
  created_at: number;
}

function toItem(row: LibraryRow): LibraryItem {
  return {
    id: row.id,
    externalId: row.external_id,
    title: row.title,
    authors: JSON.parse(row.authors_json) as string[],
    year: row.year,
    venue: row.venue,
    doi: row.doi,
    url: row.url,
    pdfUrl: row.pdf_url,
    abstract: row.abstract,
    citedByCount: row.cited_by_count,
    hasPdf: Boolean(row.pdf_file),
    tags: JSON.parse(row.tags_json) as string[],
    notes: row.notes,
    createdAt: row.created_at,
  };
}

/** Lower-cased, trimmed, de-duplicated tags. */
export function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}

export function listLibrary(userId: string): LibraryItem[] {
  return (
    getDb()
      .prepare("SELECT * FROM library_items WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId) as unknown as LibraryRow[]
  ).map(toItem);
}

export function getLibraryItem(userId: string, itemId: string): LibraryItem | null {
  const row = getDb()
    .prepare("SELECT * FROM library_items WHERE id = ? AND user_id = ?")
    .get(itemId, userId) as LibraryRow | undefined;
  return row ? toItem(row) : null;
}

export function getLibraryPdfFile(userId: string, itemId: string): string | null {
  const row = getDb()
    .prepare("SELECT pdf_file FROM library_items WHERE id = ? AND user_id = ?")
    .get(itemId, userId) as { pdf_file: string | null } | undefined;
  return row?.pdf_file ?? null;
}

export function findByExternalId(userId: string, externalId: string): LibraryItem | null {
  const row = getDb()
    .prepare("SELECT * FROM library_items WHERE user_id = ? AND external_id = ?")
    .get(userId, externalId) as LibraryRow | undefined;
  return row ? toItem(row) : null;
}

/**
 * Saves a paper. Papers with a known external id are only saved once; saving
 * again returns the existing item (and `created: false`).
 */
export function addToLibrary(userId: string, input: LibraryInput): { item: LibraryItem; created: boolean } {
  if (input.externalId) {
    const existing = findByExternalId(userId, input.externalId);
    if (existing) return { item: existing, created: false };
  }
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO library_items
         (id, user_id, external_id, title, authors_json, year, venue, doi, url, pdf_url, abstract, cited_by_count,
          pdf_file, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      input.externalId,
      input.title,
      JSON.stringify(input.authors),
      input.year,
      input.venue,
      input.doi,
      safeUrl(input.url) ?? (input.doi ? `https://doi.org/${input.doi}` : null),
      safeUrl(input.pdfUrl),
      input.abstract,
      input.citedByCount,
      input.pdfFile,
      JSON.stringify(cleanTags(input.tags ?? [])),
      now(),
    );
  return { item: getLibraryItem(userId, id)!, created: true };
}

export function updateLibraryItem(userId: string, itemId: string, changes: { tags?: string[]; notes?: string }): LibraryItem | null {
  const db = getDb();
  if (changes.tags !== undefined) {
    db.prepare("UPDATE library_items SET tags_json = ? WHERE id = ? AND user_id = ?").run(
      JSON.stringify(cleanTags(changes.tags)),
      itemId,
      userId,
    );
  }
  if (changes.notes !== undefined) {
    db.prepare("UPDATE library_items SET notes = ? WHERE id = ? AND user_id = ?").run(changes.notes, itemId, userId);
  }
  return getLibraryItem(userId, itemId);
}

/** Removes the item; returns its stored PDF file name (if any), or undefined if not found. */
export function deleteLibraryItem(userId: string, itemId: string): string | null | undefined {
  const pdfFile = getLibraryPdfFile(userId, itemId);
  const result = getDb().prepare("DELETE FROM library_items WHERE id = ? AND user_id = ?").run(itemId, userId);
  return result.changes === 0 ? undefined : pdfFile;
}

export function removeByExternalId(userId: string, externalId: string): string | null | undefined {
  const item = findByExternalId(userId, externalId);
  return item ? deleteLibraryItem(userId, item.id) : undefined;
}

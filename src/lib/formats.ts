// Import and export formats: CSV for tables, BibTeX and RIS for reference
// managers (Zotero, Mendeley, EndNote).

import { safeUrl, toCsv } from "@/lib/text";
import type { SearchBundle } from "@/lib/types";

/** Bibliographic fields shared by papers and library items. */
export interface Reference {
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  abstract: string | null;
}

// ---------------------------------------------------------------------------
// CSV

/** The table as CSV: paper metadata, screening, then each column and its supporting quote. */
export function bundleToCsv({ papers, columns, cells, screenings }: SearchBundle): string {
  const byKey = new Map(cells.map((cell) => [`${cell.paperId}:${cell.columnId}`, cell]));
  const screeningOf = new Map(screenings.map((s) => [s.paperId, s]));
  const header = [
    "Title",
    "Authors",
    "Year",
    "Venue",
    "DOI",
    "URL",
    "Citations",
    "Source",
    "Screening",
    "Screening reason",
    "Abstract",
    ...columns.flatMap((column) => [column.name, `${column.name} (supporting quote)`]),
  ];
  const rows = papers.map((paper) => {
    const screening = screeningOf.get(paper.id);
    return [
      paper.title,
      paper.authors.join("; "),
      paper.year,
      paper.venue,
      paper.doi,
      paper.url,
      paper.citedByCount,
      paper.source === "upload" ? "Uploaded PDF" : "OpenAlex",
      screening?.decision ?? "",
      screening?.reason ?? "",
      paper.abstract,
      ...columns.flatMap((column) => {
        const cell = byKey.get(`${paper.id}:${column.id}`);
        return [cell?.value ?? "", cell?.quote ?? ""];
      }),
    ];
  });
  return toCsv([header, ...rows]);
}

// ---------------------------------------------------------------------------
// BibTeX

function bibEscape(value: string): string {
  return value.replace(/[{}]/g, "").replace(/([&%$#_])/g, "\\$1").replace(/\s+/g, " ").trim();
}

function citationKey(ref: Reference, used: Set<string>): string {
  const last = (ref.authors[0] ?? "anon").split(/\s+/).at(-1) ?? "anon";
  const word = ref.title.split(/\s+/).find((w) => w.length > 3) ?? "paper";
  const base =
    `${last}${ref.year ?? ""}${word}`.normalize("NFKD").replace(/[^A-Za-z0-9]/g, "").toLowerCase() || "ref";
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}${n}`;
  used.add(key);
  return key;
}

export function toBibtex(refs: Reference[]): string {
  const used = new Set<string>();
  return refs
    .map((ref) => {
      const fields: [string, string | number | null][] = [
        ["title", ref.title],
        ["author", ref.authors.length ? ref.authors.join(" and ") : null],
        ["year", ref.year],
        ["journal", ref.venue],
        ["doi", ref.doi],
        ["url", ref.url],
        ["abstract", ref.abstract],
      ];
      const body = fields
        .filter(([, value]) => value !== null && value !== "")
        .map(([name, value]) => `  ${name} = {${bibEscape(String(value))}}`)
        .join(",\n");
      return `@article{${citationKey(ref, used)},\n${body}\n}`;
    })
    .join("\n\n") + "\n";
}

/** "Last, First" and LaTeX-ish markup to plain text. */
function bibText(value: string): string {
  return value
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/\\["'`^~=.]\{?([A-Za-z])\}?/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bibAuthor(name: string): string {
  const [last, first] = name.split(",").map((part) => part.trim());
  return first ? `${first} ${last}` : last;
}

/** Reads the field list of one entry, honouring nested braces and quotes. */
function parseBibFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    const nameMatch = /^\s*,?\s*([A-Za-z][\w-]*)\s*=\s*/.exec(body.slice(i));
    if (!nameMatch) break;
    i += nameMatch[0].length;
    const name = nameMatch[1].toLowerCase();
    let value = "";
    if (body[i] === "{") {
      let depth = 0;
      const start = i;
      for (; i < body.length; i++) {
        if (body[i] === "{") depth++;
        else if (body[i] === "}" && --depth === 0) break;
      }
      value = body.slice(start + 1, i);
      i++;
    } else if (body[i] === '"') {
      const end = body.indexOf('"', i + 1);
      value = body.slice(i + 1, end === -1 ? body.length : end);
      i = end === -1 ? body.length : end + 1;
    } else {
      const raw = /^[^,}\n]*/.exec(body.slice(i))![0];
      value = raw;
      i += raw.length;
    }
    fields[name] = bibText(value);
  }
  return fields;
}

export function parseBibtex(text: string): Reference[] {
  const refs: Reference[] = [];
  const entry = /@(\w+)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = entry.exec(text))) {
    // Find the matching closing brace of this entry (of any type, so that
    // @comment{...} blocks are skipped whole).
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    entry.lastIndex = i;
    if (["comment", "string", "preamble"].includes(match[1].toLowerCase())) continue;
    const body = text.slice(start, i - 1);
    const comma = body.indexOf(",");
    if (comma === -1) continue;
    const fields = parseBibFields(body.slice(comma + 1));
    if (!fields.title) continue;
    refs.push({
      title: fields.title,
      authors: fields.author ? fields.author.split(/\s+and\s+/i).map(bibAuthor).filter(Boolean) : [],
      year: Number.parseInt(fields.year ?? "", 10) || null,
      venue: fields.journal ?? fields.booktitle ?? fields.publisher ?? null,
      doi: fields.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") || null,
      url: safeUrl(fields.url),
      abstract: fields.abstract ?? null,
    });
  }
  return refs;
}

// ---------------------------------------------------------------------------
// RIS

export function toRis(refs: Reference[]): string {
  return (
    refs
      .map((ref) => {
        const lines = ["TY  - JOUR", `TI  - ${ref.title}`];
        for (const author of ref.authors) lines.push(`AU  - ${author}`);
        if (ref.year) lines.push(`PY  - ${ref.year}`);
        if (ref.venue) lines.push(`JO  - ${ref.venue}`);
        if (ref.doi) lines.push(`DO  - ${ref.doi}`);
        if (ref.url) lines.push(`UR  - ${ref.url}`);
        if (ref.abstract) lines.push(`AB  - ${ref.abstract.replace(/\s+/g, " ")}`);
        lines.push("ER  - ");
        return lines.join("\r\n");
      })
      .join("\r\n\r\n") + "\r\n"
  );
}

export function parseRis(text: string): Reference[] {
  const refs: Reference[] = [];
  let current: Record<string, string[]> | null = null;
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9])  -\s?(.*)$/.exec(line);
    if (!match) continue;
    const [, tag, value] = match;
    if (tag === "TY") {
      current = {};
    } else if (tag === "ER") {
      if (current) {
        const get = (...tags: string[]) => tags.map((t) => current![t]?.[0]).find(Boolean)?.trim() ?? null;
        const title = get("TI", "T1", "CT", "BT");
        if (title) {
          refs.push({
            title,
            authors: [...(current.AU ?? []), ...(current.A1 ?? [])].map((a) => bibAuthor(a.trim())).filter(Boolean),
            year: Number.parseInt(get("PY", "Y1", "DA")?.slice(0, 4) ?? "", 10) || null,
            venue: get("JO", "JF", "T2", "JA"),
            doi: get("DO")?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") ?? null,
            url: safeUrl(get("UR")),
            abstract: get("AB", "N2"),
          });
        }
      }
      current = null;
    } else if (current) {
      (current[tag] ??= []).push(value);
    }
  }
  return refs;
}

/** Detects the format from the content and parses it. */
export function parseReferences(text: string): Reference[] {
  return /^\s*TY  - /m.test(text) ? parseRis(text) : parseBibtex(text);
}

// Small text helpers used by both server and client code.

/** The value an extraction cell holds when the paper does not report the field. */
export const NOT_REPORTED = "Not reported";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * True when the quote appears in the source text, ignoring case, punctuation,
 * and whitespace. Used to show which extracted answers are verifiably quoted
 * from a paper's abstract.
 */
export function quoteIsInText(quote: string, text: string | null | undefined): boolean {
  if (!text) return false;
  const needle = normalize(quote.replace(/\.{3}|…/g, " "));
  if (needle.length < 8) return false;
  return normalize(text).includes(needle);
}

export function formatAuthors(authors: string[], max = 3): string {
  if (authors.length === 0) return "Unknown authors";
  if (authors.length <= max) return authors.join(", ");
  return `${authors.slice(0, max).join(", ")} et al.`;
}

function csvField(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Prefix formula-like values so spreadsheets do not execute them.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** A short, file-name-safe version of a title. */
export function slugify(text: string, max = 50): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, max)
      .replace(/-$/, "") || "export"
  );
}

/**
 * The URL if it uses http or https, otherwise null. Links shown in the app
 * can come from imported files, so this keeps out `javascript:` and similar.
 */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

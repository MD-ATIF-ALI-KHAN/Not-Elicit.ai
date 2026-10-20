import "server-only";
import { extractText, getDocumentProxy } from "unpdf";

export interface PdfText {
  text: string;
  pages: number;
  truncated: boolean;
}

/**
 * Extracts plain text from a PDF so it can be sent to models that do not
 * accept PDF files. Long papers are cut to `maxChars` (and flagged) so the
 * request fits within free-tier context and rate limits.
 */
export async function extractPdfText(pdf: Uint8Array, maxChars: number): Promise<PdfText> {
  // pdf.js may take ownership of the buffer it is given, so pass a copy.
  const document = await getDocumentProxy(new Uint8Array(pdf));
  const { totalPages, text } = await extractText(document, { mergePages: true });
  const clean = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return {
    text: clean.length > maxChars ? clean.slice(0, maxChars) : clean,
    pages: totalPages,
    truncated: clean.length > maxChars,
  };
}

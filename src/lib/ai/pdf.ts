import "server-only";
import { extractPdfText, type PdfText } from "@/lib/pdf-text";
import { AiRequestError } from "./errors";

/** Text of a PDF for a model to read, with clear errors for unreadable files. */
export async function pdfTextForModel(pdf: Uint8Array, maxChars: number): Promise<PdfText> {
  let result: PdfText;
  try {
    result = await extractPdfText(pdf, maxChars);
  } catch {
    throw new AiRequestError("Could not read text from this PDF. It may be damaged or password-protected.");
  }
  if (result.text.length < 200) {
    throw new AiRequestError("This PDF has almost no selectable text (it may be a scanned image), so it can't be read.");
  }
  return result;
}

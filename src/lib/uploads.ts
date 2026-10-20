import "server-only";
import { extractPdfMetadata, type PdfMetadata } from "@/lib/ai";
import { HttpError } from "@/lib/api";
import { deletePdfs, looksLikePdf, MAX_PDF_BYTES, savePdf } from "@/lib/storage";

/**
 * Refuses a request whose declared size is over the limit (plus room for the
 * multipart envelope), before any of the body is read into memory.
 */
export function rejectLargeBody(request: Request, maxBytes: number): void {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes + 64 * 1024) {
    throw new HttpError(413, `Uploads must be ${Math.round(maxBytes / 1024 / 1024)} MB or smaller.`);
  }
}

/** Reads and validates the "file" field of a multipart PDF upload. */
export async function readUploadedPdf(request: Request): Promise<{ bytes: Uint8Array; name: string }> {
  rejectLargeBody(request, MAX_PDF_BYTES);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "Expected a multipart form upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a PDF file to upload.");
  if (file.size > MAX_PDF_BYTES) throw new HttpError(413, "PDFs must be 20 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) throw new HttpError(400, "That file is not a PDF.");
  return { bytes, name: file.name };
}

/**
 * Stores an uploaded PDF and has the AI read its title, authors and abstract.
 * The stored file is removed again if reading fails.
 */
export async function storeUploadedPdf(bytes: Uint8Array, name: string): Promise<{ pdfFile: string; meta: PdfMetadata }> {
  const pdfFile = await savePdf(bytes);
  try {
    const meta = await extractPdfMetadata(bytes, name);
    return {
      pdfFile,
      meta: {
        ...meta,
        title: meta.title.trim() || name.replace(/\.pdf$/i, ""),
        doi: meta.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") || null,
      },
    };
  } catch (error) {
    await deletePdfs([pdfFile]);
    throw error;
  }
}


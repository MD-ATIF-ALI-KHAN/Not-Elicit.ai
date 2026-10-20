import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { newId } from "@/lib/ids";
import { uploadsDir } from "@/lib/db";

// Claude accepts requests up to 32 MB, and base64 adds a third, so cap uploads at 20 MB.
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

const FILE_NAME = /^[0-9a-f-]{36}\.pdf$/;

function resolve(fileName: string): string {
  // Stored names are generated UUIDs; refuse anything else so a bad value can
  // never point outside the uploads directory.
  if (!FILE_NAME.test(fileName)) throw new Error("Invalid stored file name.");
  return path.join(uploadsDir(), fileName);
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
}

export async function savePdf(bytes: Uint8Array): Promise<string> {
  const fileName = `${newId()}.pdf`;
  await fs.mkdir(uploadsDir(), { recursive: true });
  await fs.writeFile(resolve(fileName), bytes);
  return fileName;
}

export async function readPdf(fileName: string): Promise<Buffer> {
  return fs.readFile(resolve(fileName));
}

export async function deletePdfs(fileNames: (string | null | undefined)[]): Promise<void> {
  await Promise.all(
    fileNames.filter((name): name is string => Boolean(name)).map((name) => fs.rm(resolve(name), { force: true })),
  );
}

/** Copies a stored PDF so another owner (library, search) can manage it independently. */
export async function copyPdf(fileName: string): Promise<string> {
  const copy = `${newId()}.pdf`;
  await fs.copyFile(resolve(fileName), resolve(copy));
  return copy;
}

/** Serves a stored PDF inline, named after the paper's title. */
export async function pdfResponse(fileName: string, title: string): Promise<Response> {
  const bytes = await readPdf(fileName);
  const name = title.replace(/[^\w\- ]+/g, "").slice(0, 80).trim() || "paper";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

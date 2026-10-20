import { HttpError, requireApiUser, route } from "@/lib/api";
import { parseReferences } from "@/lib/formats";
import { addToLibrary } from "@/lib/repo/library";
import { rejectLargeBody } from "@/lib/uploads";
import type { LibraryItem } from "@/lib/types";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Imports a BibTeX (.bib) or RIS (.ris) file exported from Zotero, Mendeley or EndNote. */
export const POST = route(async (request) => {
  const user = await requireApiUser(request);
  rejectLargeBody(request, MAX_IMPORT_BYTES);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "Expected a multipart form upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a .bib or .ris file to import.");
  if (file.size > MAX_IMPORT_BYTES) throw new HttpError(413, "Import files must be 5 MB or smaller.");

  const refs = parseReferences(await file.text());
  if (refs.length === 0) throw new HttpError(400, "No references were found. Use a BibTeX (.bib) or RIS (.ris) file.");

  const items: LibraryItem[] = [];
  let skipped = 0;
  for (const ref of refs.slice(0, 1000)) {
    const { item, created } = addToLibrary(user.id, {
      ...ref,
      // DOIs identify imported papers so importing twice doesn't duplicate them.
      externalId: ref.doi ? `doi:${ref.doi.toLowerCase()}` : null,
      pdfUrl: null,
      citedByCount: null,
      pdfFile: null,
    });
    if (created) items.push(item);
    else skipped++;
  }
  return Response.json({ items, skipped }, { status: 201 });
});

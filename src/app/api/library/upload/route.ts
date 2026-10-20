import { requireApiUser, route } from "@/lib/api";
import { addToLibrary } from "@/lib/repo/library";
import { readUploadedPdf, storeUploadedPdf } from "@/lib/uploads";

/** Adds an uploaded PDF to the library; the AI model reads its details. */
export const POST = route(async (request) => {
  const user = await requireApiUser(request);
  const { bytes, name } = await readUploadedPdf(request);
  const { pdfFile, meta } = await storeUploadedPdf(bytes, name);
  const { item } = addToLibrary(user.id, {
    externalId: null,
    title: meta.title,
    authors: meta.authors,
    year: meta.year,
    venue: meta.venue,
    doi: meta.doi,
    url: null,
    pdfUrl: null,
    abstract: meta.abstract,
    citedByCount: null,
    pdfFile,
  });
  return Response.json({ item }, { status: 201 });
});

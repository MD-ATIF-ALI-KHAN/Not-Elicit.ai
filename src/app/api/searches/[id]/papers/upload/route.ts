import { ownedSearch, requireApiUser, route } from "@/lib/api";
import { addPapers } from "@/lib/repo/searches";
import { readUploadedPdf, storeUploadedPdf } from "@/lib/uploads";

type Ctx = { params: Promise<{ id: string }> };

/** Adds an uploaded PDF as a paper; the AI model reads its title, authors and abstract. */
export const POST = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  ownedSearch(user.id, id);

  const { bytes, name } = await readUploadedPdf(request);
  const { pdfFile, meta } = await storeUploadedPdf(bytes, name);
  const [paper] = addPapers(id, [
    {
      source: "upload",
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
    },
  ]);
  return Response.json({ paper }, { status: 201 });
});

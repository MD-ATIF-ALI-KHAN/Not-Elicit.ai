import { HttpError, requireApiUser, route } from "@/lib/api";
import { bundleToCsv, toBibtex, toRis } from "@/lib/formats";
import { getSearchBundle } from "@/lib/repo/searches";
import { slugify } from "@/lib/text";

type Ctx = { params: Promise<{ id: string }> };

const FORMATS = {
  csv: { type: "text/csv", extension: "csv" },
  bibtex: { type: "application/x-bibtex", extension: "bib" },
  ris: { type: "application/x-research-info-systems", extension: "ris" },
} as const;

/** Downloads the table as CSV, or its papers as BibTeX or RIS. */
export const GET = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  const bundle = getSearchBundle(user.id, id);
  if (!bundle) throw new HttpError(404, "Search not found.");

  const format = (new URL(request.url).searchParams.get("format") ?? "csv") as keyof typeof FORMATS;
  if (!(format in FORMATS)) throw new HttpError(400, "Unknown export format.");
  const included = new URL(request.url).searchParams.get("included") === "1";
  const keep = new Set(bundle.screenings.filter((s) => s.decision === "include").map((s) => s.paperId));
  const papers = included ? bundle.papers.filter((paper) => keep.has(paper.id)) : bundle.papers;

  const body =
    format === "csv"
      ? // A BOM makes Excel open the file as UTF-8.
        "﻿" + bundleToCsv({ ...bundle, papers })
      : format === "bibtex"
        ? toBibtex(papers)
        : toRis(papers);
  return new Response(body, {
    headers: {
      "Content-Type": `${FORMATS[format].type}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="not-elicit-${slugify(bundle.search.question)}.${FORMATS[format].extension}"`,
      "Cache-Control": "no-store",
    },
  });
});

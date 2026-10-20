import { HttpError, requireApiUser, route } from "@/lib/api";
import { toBibtex, toRis } from "@/lib/formats";
import { listLibrary } from "@/lib/repo/library";
import { toCsv } from "@/lib/text";

const FORMATS = {
  bibtex: { type: "application/x-bibtex", extension: "bib" },
  ris: { type: "application/x-research-info-systems", extension: "ris" },
  csv: { type: "text/csv", extension: "csv" },
} as const;

/** Downloads the library (or the selected ids) as BibTeX, RIS or CSV. */
export const GET = route(async (request) => {
  const user = await requireApiUser(request);
  const params = new URL(request.url).searchParams;
  const format = (params.get("format") ?? "bibtex") as keyof typeof FORMATS;
  if (!(format in FORMATS)) throw new HttpError(400, "Unknown export format.");
  const ids = params.get("ids")?.split(",").filter(Boolean);
  const items = listLibrary(user.id).filter((item) => !ids || ids.includes(item.id));

  const body =
    format === "bibtex"
      ? toBibtex(items)
      : format === "ris"
        ? toRis(items)
        : "﻿" +
          toCsv([
            ["Title", "Authors", "Year", "Venue", "DOI", "URL", "Tags", "Notes", "Abstract"],
            ...items.map((item) => [
              item.title,
              item.authors.join("; "),
              item.year,
              item.venue,
              item.doi,
              item.url,
              item.tags.join("; "),
              item.notes,
              item.abstract,
            ]),
          ]);
  return new Response(body, {
    headers: {
      "Content-Type": `${FORMATS[format].type}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="not-elicit-library.${FORMATS[format].extension}"`,
      "Cache-Control": "no-store",
    },
  });
});

import { z } from "zod";
import { extractCells } from "@/lib/ai";
import { HttpError, ownedSearch, parseJson, requireApiUser, route } from "@/lib/api";
import { getPaper, getPaperPdfFile, listColumns, saveCells } from "@/lib/repo/searches";
import { readPdf } from "@/lib/storage";
import { NOT_REPORTED } from "@/lib/text";
import type { Cell } from "@/lib/types";

type Ctx = { params: Promise<{ id: string; paperId: string }> };

const Extract = z.object({
  columnIds: z.array(z.string()).max(50).optional(),
});

/** Fills extraction-table cells for one paper (all columns, or the ones given). */
export const POST = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id, paperId } = await params;
  const search = ownedSearch(user.id, id);
  const { columnIds } = await parseJson(request, Extract);

  const paper = getPaper(id, paperId);
  if (!paper) throw new HttpError(404, "Paper not found.");
  const columns = listColumns(id).filter((column) => !columnIds || columnIds.includes(column.id));
  if (columns.length === 0) return Response.json({ cells: [] });

  const pdfFile = getPaperPdfFile(id, paperId);
  let cells: Cell[];
  if (!pdfFile && !paper.abstract) {
    cells = columns.map((column) => ({ paperId, columnId: column.id, value: NOT_REPORTED, quote: "" }));
  } else {
    const pdf = pdfFile ? new Uint8Array(await readPdf(pdfFile)) : undefined;
    cells = await extractCells({ question: search.question, paper, columns, pdf });
  }
  saveCells(cells);
  return Response.json({ cells });
});

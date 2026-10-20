import { z } from "zod";
import { ownedSearch, parseJson, requireApiUser, route } from "@/lib/api";
import { saveCriteria } from "@/lib/repo/searches";

type Ctx = { params: Promise<{ id: string }> };

const Criteria = z.object({
  criteria: z
    .array(z.string().trim().min(3, "Each criterion needs a few words.").max(300))
    .max(10, "Use at most 10 criteria."),
});

/** Saves the inclusion criteria used for screening. */
export const PUT = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  ownedSearch(user.id, id);
  const { criteria } = await parseJson(request, Criteria);
  saveCriteria(id, criteria);
  return Response.json({ criteria });
});

import { z } from "zod";
import { ownedSearch, parseJson, requireApiUser, route } from "@/lib/api";
import { addColumn } from "@/lib/repo/searches";

type Ctx = { params: Promise<{ id: string }> };

const AddColumn = z.object({
  name: z.string().trim().min(1, "Give the column a name.").max(60, "Keep column names under 60 characters."),
  instructions: z.string().trim().max(500, "Keep instructions under 500 characters.").default(""),
});

export const POST = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  ownedSearch(user.id, id);
  const { name, instructions } = await parseJson(request, AddColumn);
  return Response.json({ column: addColumn(id, name, instructions) }, { status: 201 });
});

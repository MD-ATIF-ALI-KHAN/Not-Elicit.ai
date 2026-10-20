import { z } from "zod";
import { parseJson, requireApiUser, route } from "@/lib/api";
import { createProject } from "@/lib/repo/projects";

const CreateProject = z.object({
  name: z.string().trim().min(1, "Give the project a name.").max(100, "Keep the name under 100 characters."),
  description: z.string().trim().max(1000, "Keep the description under 1000 characters.").default(""),
});

export const POST = route(async (request) => {
  const user = await requireApiUser(request);
  const { name, description } = await parseJson(request, CreateProject);
  return Response.json({ project: createProject(user.id, name, description) }, { status: 201 });
});

import { z } from "zod";
import { HttpError, ownedProject, parseJson, requireApiUser, route } from "@/lib/api";
import { deleteProject, getProject, updateProject } from "@/lib/repo/projects";
import { deletePdfs } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

const UpdateProject = z.object({
  name: z.string().trim().min(1, "Give the project a name.").max(100).optional(),
  description: z.string().trim().max(1000).optional(),
});

export const PATCH = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  ownedProject(user.id, id);
  updateProject(id, await parseJson(request, UpdateProject));
  return Response.json({ project: getProject(user.id, id) });
});

export const DELETE = route(async (request, { params }: Ctx) => {
  const user = await requireApiUser(request);
  const { id } = await params;
  const files = deleteProject(user.id, id);
  if (files === null) throw new HttpError(404, "Project not found.");
  await deletePdfs(files);
  return new Response(null, { status: 204 });
});

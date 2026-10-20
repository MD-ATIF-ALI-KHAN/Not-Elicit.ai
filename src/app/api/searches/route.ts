import { z } from "zod";
import { planSearchQuery } from "@/lib/ai";
import { ownedProject, parseJson, requireApiUser, route } from "@/lib/api";
import { searchWorks } from "@/lib/openalex";
import { defaultProject } from "@/lib/repo/projects";
import { createSearch, workToPaperInput } from "@/lib/repo/searches";
import { SearchFiltersSchema } from "@/lib/schemas";

const CreateSearch = z.object({
  question: z
    .string()
    .trim()
    .min(5, "Please enter a research question of at least 5 characters.")
    .max(500, "Please keep the question under 500 characters."),
  projectId: z.string().optional(),
  filters: SearchFiltersSchema.default({}),
});

/** Starts a search: plans a query, fetches the first page of papers into a new table. */
export const POST = route(async (request) => {
  const user = await requireApiUser(request);
  const { question, projectId, filters } = await parseJson(request, CreateSearch);
  const project = projectId ? ownedProject(user.id, projectId) : defaultProject(user.id);

  let searchQuery = await planSearchQuery(question);
  let page = await searchWorks(searchQuery, 1, fetch, filters);
  if (page.works.length === 0 && searchQuery !== question) {
    // The planned query may be too narrow; fall back to the user's own words.
    searchQuery = question;
    page = await searchWorks(searchQuery, 1, fetch, filters);
  }

  const id = createSearch({
    userId: user.id,
    projectId: project.id,
    question,
    searchQuery,
    filters,
    papers: page.works.map(workToPaperInput),
    totalResults: page.totalResults,
  });
  return Response.json({ id }, { status: 201 });
});

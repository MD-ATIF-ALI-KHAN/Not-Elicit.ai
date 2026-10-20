import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aiStatus } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { PAGE_SIZE } from "@/lib/openalex";
import { getProject } from "@/lib/repo/projects";
import { getSearch, getSearchBundle } from "@/lib/repo/searches";
import { Workspace } from "./Workspace";

export async function generateMetadata({ params }: PageProps<"/searches/[id]">): Promise<Metadata> {
  const user = await requireUser();
  const { id } = await params;
  return { title: getSearch(user.id, id)?.question ?? "Table" };
}

export default async function SearchPage({ params }: PageProps<"/searches/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const bundle = getSearchBundle(user.id, id);
  if (!bundle) notFound();

  const { search } = bundle;
  const project = getProject(user.id, search.projectId);
  const hasMore = search.kind === "search" && (search.nextPage - 1) * PAGE_SIZE < (search.totalResults ?? 0);
  return (
    <Workspace
      initial={bundle}
      initialHasMore={hasMore}
      project={{ id: search.projectId, name: project?.name ?? "Project" }}
      ai={aiStatus()}
    />
  );
}

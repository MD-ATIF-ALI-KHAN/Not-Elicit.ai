import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuestionForm } from "@/components/QuestionForm";
import { SearchList } from "@/components/SearchList";
import { requireUser } from "@/lib/auth";
import { listChats } from "@/lib/repo/chats";
import { getProject } from "@/lib/repo/projects";
import { listSearches } from "@/lib/repo/searches";
import { ChatList, NewChatButton } from "./Chats";
import { ProjectHeader } from "./ProjectHeader";

export async function generateMetadata({ params }: PageProps<"/projects/[id]">): Promise<Metadata> {
  const user = await requireUser();
  const { id } = await params;
  return { title: getProject(user.id, id)?.name ?? "Project" };
}

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const project = getProject(user.id, id);
  if (!project) notFound();
  const searches = listSearches(user.id, id);
  const chats = listChats(user.id, id);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <ProjectHeader project={project} />

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">New search in this project</h2>
        <QuestionForm signedIn initialProjectId={project.id} showExamples={searches.length === 0} />
      </section>

      <div className="mt-12 grid gap-10 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">Tables</h2>
          <SearchList searches={searches} empty="Search for papers above, or build a table from your library." />
        </section>
        <section className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Chats</h2>
            <NewChatButton projectId={project.id} />
          </div>
          <ChatList chats={chats} />
        </section>
      </div>
    </main>
  );
}

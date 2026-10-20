import type { Metadata } from "next";
import Link from "next/link";
import { NewProjectButton } from "@/components/NewProjectButton";
import { QuestionForm } from "@/components/QuestionForm";
import { SearchList } from "@/components/SearchList";
import { requireUser } from "@/lib/auth";
import { listLibrary } from "@/lib/repo/library";
import { listProjects } from "@/lib/repo/projects";
import { listSearches } from "@/lib/repo/searches";

export const metadata: Metadata = { title: "Projects" };

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  const { q } = await searchParams;
  const projects = listProjects(user.id);
  const searches = listSearches(user.id).slice(0, 6);
  const libraryCount = listLibrary(user.id).length;
  const projectNames = Object.fromEntries(projects.map((project) => [project.id, project.name]));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <h1 className="font-serif text-3xl font-semibold text-ink-950">What do you want to research?</h1>
      <p className="mt-2 text-slate-600">Ask a question to get a cited answer and a table of evidence from academic papers.</p>
      <div className="mt-6">
        <QuestionForm
          signedIn
          projects={projects.map((project) => ({ id: project.id, name: project.name }))}
          initialQuestion={typeof q === "string" ? q : ""}
          showExamples={searches.length === 0}
          autoFocus
        />
      </div>

      <section className="mt-14">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Projects</h2>
          <NewProjectButton />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-ink-300 hover:shadow"
            >
              <p className="font-serif text-lg font-semibold text-ink-950 group-hover:underline">{project.name}</p>
              {project.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{project.description}</p>}
              <p className="mt-3 text-xs text-slate-500">
                {project.searchCount} {project.searchCount === 1 ? "table" : "tables"} · {project.chatCount}{" "}
                {project.chatCount === 1 ? "chat" : "chats"} · updated {dateFormat.format(project.updatedAt)}
              </p>
            </Link>
          ))}
          <Link
            href="/library"
            className="group rounded-2xl border border-dashed border-slate-300 p-5 transition hover:border-ink-300 hover:bg-white"
          >
            <p className="font-serif text-lg font-semibold text-ink-950 group-hover:underline">📚 Your library</p>
            <p className="mt-1 text-sm text-slate-600">
              {libraryCount} saved {libraryCount === 1 ? "paper" : "papers"}. Upload PDFs, import from Zotero, tag and export.
            </p>
          </Link>
        </div>
        {projects.length === 0 && (
          <p className="mt-4 text-sm text-slate-500">
            Your first search will create a “My research” project, or create your own to organise things.
          </p>
        )}
      </section>

      <section className="mt-14">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">Recent tables</h2>
        <SearchList searches={searches} projectNames={projectNames} />
      </section>
    </main>
  );
}

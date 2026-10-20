import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { listLibrary } from "@/lib/repo/library";
import { listProjects } from "@/lib/repo/projects";
import { LibraryView } from "./LibraryView";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage() {
  const user = await requireUser();
  return (
    <LibraryView
      initialItems={listLibrary(user.id)}
      projects={listProjects(user.id).map((project) => ({ id: project.id, name: project.name }))}
    />
  );
}

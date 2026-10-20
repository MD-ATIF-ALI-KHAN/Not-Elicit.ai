"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonPrimary, inputClass, Modal } from "@/components/Modal";
import type { Project } from "@/lib/types";

export function ProjectHeader({ project }: { project: Project }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    if (!response.ok) {
      setError(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not save.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete the project “${project.name}” with all its tables and chats? This can't be undone.`)) return;
    const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    if (response.ok) router.push("/dashboard");
    else alert("Could not delete the project.");
  }

  return (
    <div>
      <Link href="/dashboard" className="text-sm text-slate-500 hover:text-ink-800">
        ← Projects
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-ink-950">{project.name}</h1>
          {project.description && <p className="mt-2 max-w-2xl text-slate-600">{project.description}</p>}
        </div>
        <div className="flex gap-2 text-sm">
          <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50">
            Edit
          </button>
          <button type="button" onClick={remove} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-red-700 hover:bg-red-50">
            Delete
          </button>
        </div>
      </div>

      {editing && (
        <Modal title="Edit project" onClose={() => setEditing(false)}>
          <form onSubmit={save} className="space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} className={inputClass} />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Description
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3} className={inputClass} />
            </label>
            {error && <p className="text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-4 py-2 text-slate-700 hover:bg-slate-100">
                Cancel
              </button>
              <button type="submit" disabled={!name.trim()} className={buttonPrimary}>
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

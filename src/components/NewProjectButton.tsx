"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonPrimary, inputClass, Modal } from "@/components/Modal";

export function NewProjectButton({ className = buttonPrimary, label = "+ New project" }: { className?: string; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    const body = (await response.json().catch(() => null)) as { project?: { id: string }; error?: string } | null;
    if (!response.ok || !body?.project) {
      setError(body?.error ?? "Could not create the project.");
      setSaving(false);
      return;
    }
    router.push(`/projects/${body.project.id}`);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>
      {open && (
        <Modal title="New project" onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
                autoFocus
                placeholder="e.g. Thesis literature review"
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Description <span className="font-normal text-slate-400">(optional)</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="What is this project about?"
                className={inputClass}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-slate-700 hover:bg-slate-100">
                Cancel
              </button>
              <button type="submit" disabled={saving || !name.trim()} className={buttonPrimary}>
                {saving ? "Creating…" : "Create project"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

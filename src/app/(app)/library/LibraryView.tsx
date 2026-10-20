"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { buttonPrimary, buttonSecondary, inputClass, Modal } from "@/components/Modal";
import { formatAuthors, safeUrl } from "@/lib/text";
import type { LibraryItem } from "@/lib/types";

type ProjectOption = { id: string; name: string };

async function errorOf(response: Response, fallback: string): Promise<string> {
  return ((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? fallback;
}

export function LibraryView({ initialItems, projects }: { initialItems: LibraryItem[]; projects: ProjectOption[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [action, setAction] = useState<"table" | "chat" | null>(null);

  const tags = useMemo(() => [...new Set(items.flatMap((item) => item.tags))].sort(), [items]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        (!tag || item.tags.includes(tag)) &&
        (!q || [item.title, item.authors.join(" "), item.abstract ?? "", item.notes, item.venue ?? ""].join(" ").toLowerCase().includes(q)),
    );
  }, [items, query, tag]);
  const open = items.find((item) => item.id === openId);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function upload(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      setBusy(`Reading ${file.name}…`);
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/library/upload", { method: "POST", body: form });
      if (response.ok) {
        const { item } = (await response.json()) as { item: LibraryItem };
        setItems((current) => [item, ...current]);
        setNotice({ kind: "info", text: `Added “${item.title}”.` });
      } else {
        setNotice({ kind: "error", text: await errorOf(response, `Could not add ${file.name}.`) });
      }
    }
    setBusy(null);
  }

  async function importFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(`Importing ${file.name}…`);
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/library/import", { method: "POST", body: form });
    if (response.ok) {
      const body = (await response.json()) as { items: LibraryItem[]; skipped: number };
      setItems((current) => [...body.items, ...current]);
      setNotice({
        kind: "info",
        text: `Imported ${body.items.length} ${body.items.length === 1 ? "paper" : "papers"}${body.skipped ? ` (${body.skipped} already in your library)` : ""}.`,
      });
    } else {
      setNotice({ kind: "error", text: await errorOf(response, "Could not import that file.") });
    }
    setBusy(null);
  }

  async function remove(ids: string[]) {
    if (!confirm(`Remove ${ids.length === 1 ? "this paper" : `${ids.length} papers`} from your library?`)) return;
    for (const id of ids) {
      const response = await fetch(`/api/library/${id}`, { method: "DELETE" });
      if (response.ok) {
        setItems((current) => current.filter((item) => item.id !== id));
        setSelected((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    }
    if (openId && ids.includes(openId)) setOpenId(null);
  }

  async function update(id: string, changes: { tags?: string[]; notes?: string }) {
    const response = await fetch(`/api/library/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
    if (response.ok) {
      const { item } = (await response.json()) as { item: LibraryItem };
      setItems((current) => current.map((i) => (i.id === id ? item : i)));
    }
  }

  const selectedIds = [...selected].filter((id) => items.some((item) => item.id === id));
  const exportHref = (format: string) =>
    `/api/library/export?format=${format}${selectedIds.length ? `&ids=${selectedIds.join(",")}` : ""}`;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-ink-950">Library</h1>
          <p className="mt-1 text-slate-600">
            {items.length} saved {items.length === 1 ? "paper" : "papers"}. Save papers from any table with ☆, upload PDFs, or import from
            Zotero, Mendeley or EndNote.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <label className={`${buttonSecondary} cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
            Upload PDFs
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="sr-only"
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <label className={`${buttonSecondary} cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
            Import .bib / .ris
            <input
              type="file"
              accept=".bib,.ris,.txt"
              className="sr-only"
              onChange={(e) => {
                void importFile(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <span className="flex items-center gap-1 text-slate-500">
            Export{selectedIds.length ? " selected" : ""}:
            <a href={exportHref("bibtex")} className="font-medium text-ink-700 hover:underline">BibTeX</a>·
            <a href={exportHref("ris")} className="font-medium text-ink-700 hover:underline">RIS</a>·
            <a href={exportHref("csv")} className="font-medium text-ink-700 hover:underline">CSV</a>
          </span>
        </div>
      </div>

      {busy && <p className="mt-4 animate-pulse text-sm text-slate-600">{busy}</p>}
      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`mt-4 flex justify-between gap-4 rounded-lg px-4 py-3 text-sm ${notice.kind === "error" ? "bg-red-50 text-red-800" : "bg-ink-50 text-ink-800"}`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your library…"
          aria-label="Search your library"
          className="w-full max-w-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-ink-500 focus:ring-2 focus:ring-ink-200"
        />
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-sm">
            <button
              type="button"
              onClick={() => setTag(null)}
              className={`rounded-full px-3 py-1 ${tag === null ? "bg-ink-800 text-white" : "border border-slate-200 bg-white text-slate-600"}`}
            >
              All
            </button>
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTag(t === tag ? null : t)}
                className={`rounded-full px-3 py-1 ${tag === t ? "bg-ink-800 text-white" : "border border-slate-200 bg-white text-slate-600"}`}
              >
                #{t}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedIds.length > 0 && (
        <div className="sticky top-2 z-10 mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-ink-900 px-4 py-3 text-sm text-white shadow-lg">
          <span className="font-medium">{selectedIds.length} selected</span>
          <button type="button" onClick={() => setAction("table")} className="rounded-md bg-white/10 px-3 py-1.5 hover:bg-white/20">
            Create table
          </button>
          <button type="button" onClick={() => setAction("chat")} className="rounded-md bg-white/10 px-3 py-1.5 hover:bg-white/20">
            Chat with these
          </button>
          <button type="button" onClick={() => remove(selectedIds)} className="rounded-md bg-white/10 px-3 py-1.5 hover:bg-red-500/40">
            Remove
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-white/70 hover:text-white">
            Clear
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          Your library is empty. Star (☆) papers in any table to save them here, upload PDFs, or import a .bib/.ris file.
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {visible.map((item) => (
            <li key={item.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
              <input
                type="checkbox"
                aria-label={`Select ${item.title}`}
                checked={selected.has(item.id)}
                onChange={() => toggle(item.id)}
                className="mt-1.5"
              />
              <button type="button" onClick={() => setOpenId(item.id)} className="min-w-0 flex-1 text-left">
                <p className="font-medium leading-snug text-ink-900 hover:underline">{item.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {formatAuthors(item.authors, 3)}
                  {item.year ? ` · ${item.year}` : ""}
                  {item.venue ? ` · ${item.venue}` : ""}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[0.7rem]">
                  {item.hasPdf && <span className="rounded bg-ink-100 px-1.5 py-0.5 font-medium text-ink-800">PDF</span>}
                  {item.tags.map((t) => (
                    <span key={t} className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">
                      #{t}
                    </span>
                  ))}
                  {item.notes && <span className="text-slate-400">has notes</span>}
                </div>
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No papers match.</li>}
        </ul>
      )}

      {open && <ItemDrawer item={open} onClose={() => setOpenId(null)} onUpdate={update} onRemove={() => remove([open.id])} />}

      {action && (
        <SendToProject
          kind={action}
          count={selectedIds.length}
          projects={projects}
          onClose={() => setAction(null)}
          onSubmit={async (projectId, title) => {
            const response =
              action === "table"
                ? await fetch("/api/searches/manual", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ projectId, title, libraryItemIds: selectedIds }),
                  })
                : await fetch("/api/chats", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ projectId, mode: "papers", libraryItemIds: selectedIds }),
                  });
            if (!response.ok) throw new Error(await errorOf(response, "Something went wrong."));
            const { id } = (await response.json()) as { id: string };
            router.push(action === "table" ? `/searches/${id}` : `/chats/${id}`);
          }}
        />
      )}
    </main>
  );
}

function ItemDrawer({
  item,
  onClose,
  onUpdate,
  onRemove,
}: {
  item: LibraryItem;
  onClose: () => void;
  onUpdate: (id: string, changes: { tags?: string[]; notes?: string }) => Promise<void>;
  onRemove: () => void;
}) {
  const [tags, setTags] = useState(item.tags.join(", "));
  const [notes, setNotes] = useState(item.notes);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={item.title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink-950/30" />
      <aside className="relative h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl">
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">
            Close ✕
          </button>
        </div>
        <h2 className="font-serif text-2xl font-semibold leading-snug text-ink-950">{item.title}</h2>
        <p className="mt-2 text-sm text-slate-600">{formatAuthors(item.authors, 8)}</p>
        <p className="mt-1 text-sm text-slate-500">{[item.year, item.venue].filter(Boolean).join(" · ")}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {safeUrl(item.url) && (
            <a href={safeUrl(item.url)!} target="_blank" rel="noreferrer" className={buttonSecondary}>
              Open paper ↗
            </a>
          )}
          {item.hasPdf ? (
            <a href={`/api/library/${item.id}/pdf`} target="_blank" rel="noreferrer" className={buttonSecondary}>
              View PDF ↗
            </a>
          ) : (
            safeUrl(item.pdfUrl) && (
              <a href={safeUrl(item.pdfUrl)!} target="_blank" rel="noreferrer" className={buttonSecondary}>
                Open-access PDF ↗
              </a>
            )
          )}
        </div>

        <label className="mt-6 block text-sm font-medium text-slate-700">
          Tags <span className="font-normal text-slate-400">(comma-separated)</span>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            onBlur={() => onUpdate(item.id, { tags: tags.split(",") })}
            placeholder="e.g. methods, to-read"
            className={inputClass}
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => onUpdate(item.id, { notes })}
            rows={4}
            placeholder="Your notes on this paper…"
            className={inputClass}
          />
        </label>

        <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-slate-500">Abstract</h3>
        <p className="mt-2 whitespace-pre-line font-serif leading-relaxed text-slate-800">{item.abstract || "No abstract available."}</p>

        <button type="button" onClick={onRemove} className="mt-8 text-sm text-red-700 hover:underline">
          Remove from library
        </button>
      </aside>
    </div>
  );
}

function SendToProject({
  kind,
  count,
  projects,
  onClose,
  onSubmit,
}: {
  kind: "table" | "chat";
  count: number;
  projects: ProjectOption[];
  onClose: () => void;
  onSubmit: (projectId: string, title: string) => Promise<void>;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [newName, setNewName] = useState(projects.length === 0 ? "My research" : "");
  const [title, setTitle] = useState(`${count} papers from my library`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      let target = projectId;
      if (!target) {
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName.trim() || "My research" }),
        });
        if (!response.ok) throw new Error(await errorOf(response, "Could not create the project."));
        target = ((await response.json()) as { project: { id: string } }).project.id;
      }
      await onSubmit(target, title.trim() || "Library papers");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSaving(false);
    }
  }

  return (
    <Modal title={kind === "table" ? `Create a table from ${count} papers` : `Chat with ${count} papers`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium text-slate-700">
          Project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputClass}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
            <option value="">+ New project…</option>
          </select>
        </label>
        {!projectId && (
          <label className="block text-sm font-medium text-slate-700">
            New project name
            <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={100} className={inputClass} />
          </label>
        )}
        {kind === "table" && (
          <label className="block text-sm font-medium text-slate-700">
            Table title
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} className={inputClass} />
          </label>
        )}
        {kind === "table" && (
          <p className="text-sm text-slate-500">
            The AI will fill in study design, population, findings and limitations for each paper. You can add columns.
          </p>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-slate-700 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" disabled={saving} className={buttonPrimary}>
            {saving ? "Working…" : kind === "table" ? "Create table" : "Start chat"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

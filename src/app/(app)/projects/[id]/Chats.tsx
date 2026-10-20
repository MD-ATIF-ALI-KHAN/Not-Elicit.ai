"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonSecondary } from "@/components/Modal";
import type { ChatListItem } from "@/lib/types";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

/** Starts a research chat (it finds its own papers) and opens it. */
export function NewChatButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    const response = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, mode: "search" }),
    });
    const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (response.ok && body?.id) router.push(`/chats/${body.id}`);
    else {
      alert(body?.error ?? "Could not start a chat.");
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={start} disabled={busy} className={buttonSecondary}>
      {busy ? "Starting…" : "+ New chat"}
    </button>
  );
}

export function ChatList({ chats }: { chats: ChatListItem[] }) {
  const router = useRouter();

  async function remove(chat: ChatListItem) {
    if (!confirm(`Delete the chat “${chat.title}”?`)) return;
    const response = await fetch(`/api/chats/${chat.id}`, { method: "DELETE" });
    if (response.ok) router.refresh();
  }

  if (chats.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Ask follow-up questions in a chat. The assistant finds papers for each question and cites them, or chats about
        papers you pick from a table or your library.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {chats.map((chat) => (
        <li key={chat.id} className="group flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
          <span aria-hidden>💬</span>
          <Link href={`/chats/${chat.id}`} className="min-w-0 flex-1">
            <p className="truncate font-medium text-ink-900 group-hover:underline">{chat.title}</p>
            <p className="text-xs text-slate-500">
              {chat.mode === "search" ? "Research assistant" : "Chat with papers"} · {chat.messageCount} messages ·{" "}
              {dateFormat.format(chat.updatedAt)}
            </p>
          </Link>
          <button
            type="button"
            onClick={() => remove(chat)}
            className="rounded px-2 py-1 text-sm text-slate-400 opacity-0 hover:bg-red-50 hover:text-red-700 focus:opacity-100 group-hover:opacity-100"
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aiStatus } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { getChat, getChatBundle } from "@/lib/repo/chats";
import { ChatView } from "./ChatView";

export async function generateMetadata({ params }: PageProps<"/chats/[id]">): Promise<Metadata> {
  const user = await requireUser();
  const { id } = await params;
  return { title: getChat(user.id, id)?.title ?? "Chat" };
}

export default async function ChatPage({ params }: PageProps<"/chats/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const bundle = getChatBundle(user.id, id);
  if (!bundle) notFound();
  return <ChatView initial={bundle} ai={aiStatus()} />;
}

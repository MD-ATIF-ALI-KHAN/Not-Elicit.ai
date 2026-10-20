import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { AiRateLimitError, AiRefusalError, AiRequestError, AiUnavailableError } from "@/lib/ai";
import { OpenAlexError } from "@/lib/openalex";
import { getChat } from "@/lib/repo/chats";
import { getProject } from "@/lib/repo/projects";
import { getSearch } from "@/lib/repo/searches";
import type { Chat, Project, PublicUser, Search, SummaryStreamEvent } from "@/lib/types";

/** An error whose message is safe to show the user, with an HTTP status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Cookies are SameSite=Lax, which already blocks most cross-site POSTs; also
 * reject state-changing requests whose Origin is a different host.
 */
function assertSameOrigin(request: Request): void {
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host || new URL(origin).host !== host) throw new HttpError(403, "Cross-origin request rejected.");
}

export async function requireApiUser(request: Request): Promise<PublicUser> {
  assertSameOrigin(request);
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Please sign in.");
  return user;
}

// Loaders for things the user owns. Other users' ids get the same 404 as
// ids that don't exist, so they can't probe for them.

export function ownedProject(userId: string, projectId: string): Project {
  const project = getProject(userId, projectId);
  if (!project) throw new HttpError(404, "Project not found.");
  return project;
}

export function ownedSearch(userId: string, searchId: string): Search {
  const search = getSearch(userId, searchId);
  if (!search) throw new HttpError(404, "Search not found.");
  return search;
}

export function ownedChat(userId: string, chatId: string): Chat {
  const chat = getChat(userId, chatId);
  if (!chat) throw new HttpError(404, "Chat not found.");
  return chat;
}

/**
 * Streams newline-delimited JSON events produced by `run`. Errors become a
 * final `error` event, since the HTTP status has already been sent.
 */
export function ndjsonResponse(
  request: Request,
  run: (send: (event: SummaryStreamEvent) => void, signal: AbortSignal) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SummaryStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // The client went away; the abort signal stops the model call.
        }
      };
      try {
        await run(send, request.signal);
      } catch (error) {
        if (!request.signal.aborted) {
          const { error: message } = (await errorResponse(error).json()) as { error: string };
          send({ type: "error", message });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a disconnect.
        }
      }
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function parseJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0]?.message ?? "Invalid request.");
  }
  return result.data;
}

/** Maps any thrown error to a JSON response with a user-presentable message. */
export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return jsonError(error.status, error.message);
  if (error instanceof AiRefusalError) return jsonError(422, error.message);
  if (error instanceof OpenAlexError) return jsonError(502, error.message);
  // Errors from the AI layer carry messages written for the user.
  if (error instanceof AiUnavailableError) return jsonError(503, error.message);
  if (error instanceof AiRateLimitError) return jsonError(429, error.message);
  if (error instanceof AiRequestError) {
    console.error("AI request error:", error.message);
    return jsonError(502, error.message);
  }
  // Typed errors from the Anthropic SDK (Claude provider).
  if (error instanceof Anthropic.AuthenticationError) {
    return jsonError(503, "The Anthropic API key is missing or invalid. Check ANTHROPIC_API_KEY in .env.local.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return jsonError(429, "Claude is rate limiting requests right now. Wait a minute, then use Retry.");
  }
  if (error instanceof Anthropic.APIError) {
    console.error("Anthropic API error", error.status, error.message);
    return jsonError(502, `Claude returned an error (${error.status ?? "network"}). Please try again.`);
  }
  if (error instanceof Anthropic.AnthropicError) {
    console.error("Claude unavailable:", error.message);
    return jsonError(503, "Claude couldn't be reached. Check ANTHROPIC_API_KEY in .env.local and restart the server.");
  }
  console.error(error);
  return jsonError(500, "Something went wrong. Please try again.");
}

/** Wraps a route handler so thrown errors become JSON responses. */
export function route<Ctx>(handler: (request: Request, ctx: Ctx) => Promise<Response>) {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await handler(request, ctx);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

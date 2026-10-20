import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser, SummaryStreamEvent } from "@/lib/types";
import fixture from "./fixtures/openalex-works.json";
import { useFreshDb } from "./helpers";

// Route handlers read the signed-in user from the session cookie; tests set it directly.
const session = vi.hoisted(() => ({ user: null as PublicUser | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => session.user }));

// AI features are replaced with fakes; everything else (DB, validation, storage) is real.
const ai = vi.hoisted(() => ({
  planSearchQuery: vi.fn(async (question: string) => `planned: ${question}`),
  extractCells: vi.fn(),
  extractPdfMetadata: vi.fn(),
  summarize: vi.fn(),
  writeReport: vi.fn(),
  screenPaper: vi.fn(),
  chatReply: vi.fn(),
  pdfTextForChat: vi.fn(async () => "Extracted full text"),
}));
vi.mock("@/lib/ai", async (importOriginal) => ({ ...(await importOriginal<object>()), ...ai }));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "not-elicit-test-"));
process.env.NOT_ELICIT_DATA_DIR = dataDir;
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
const uploads = () => (fs.existsSync(path.join(dataDir, "uploads")) ? fs.readdirSync(path.join(dataDir, "uploads")) : []);

const projectsRoute = await import("@/app/api/projects/route");
const projectRoute = await import("@/app/api/projects/[id]/route");
const searchesRoute = await import("@/app/api/searches/route");
const manualRoute = await import("@/app/api/searches/manual/route");
const searchRoute = await import("@/app/api/searches/[id]/route");
const summaryRoute = await import("@/app/api/searches/[id]/summary/route");
const reportRoute = await import("@/app/api/searches/[id]/report/route");
const criteriaRoute = await import("@/app/api/searches/[id]/criteria/route");
const columnsRoute = await import("@/app/api/searches/[id]/columns/route");
const columnRoute = await import("@/app/api/searches/[id]/columns/[columnId]/route");
const exportRoute = await import("@/app/api/searches/[id]/export/route");
const moreRoute = await import("@/app/api/searches/[id]/papers/more/route");
const uploadRoute = await import("@/app/api/searches/[id]/papers/upload/route");
const paperRoute = await import("@/app/api/searches/[id]/papers/[paperId]/route");
const extractRoute = await import("@/app/api/searches/[id]/papers/[paperId]/extract/route");
const pdfRoute = await import("@/app/api/searches/[id]/papers/[paperId]/pdf/route");
const screenRoute = await import("@/app/api/searches/[id]/papers/[paperId]/screen/route");
const trailRoute = await import("@/app/api/searches/[id]/papers/[paperId]/trail/route");
const libraryRoute = await import("@/app/api/library/route");
const libraryUploadRoute = await import("@/app/api/library/upload/route");
const libraryImportRoute = await import("@/app/api/library/import/route");
const libraryExportRoute = await import("@/app/api/library/export/route");
const libraryItemRoute = await import("@/app/api/library/[id]/route");
const chatsRoute = await import("@/app/api/chats/route");
const chatRoute = await import("@/app/api/chats/[id]/route");
const messagesRoute = await import("@/app/api/chats/[id]/messages/route");
const { createUser } = await import("@/lib/users");
const { getSearchBundle } = await import("@/lib/repo/searches");
const { listProjects } = await import("@/lib/repo/projects");
const { listLibrary } = await import("@/lib/repo/library");
const { getChatBundle } = await import("@/lib/repo/chats");
const { AiRefusalError, AiUnavailableError } = await import("@/lib/ai/errors");

function request(method: string, body?: unknown, headers: Record<string, string> = {}, url = "http://localhost/api/test"): Request {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  return new Request(url, init);
}

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const events = async (response: Response) =>
  (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as SummaryStreamEvent);
const cited = { segments: [{ text: "It may help.", paperIds: [] as string[] }], model: "fake" };

let alice: PublicUser;
let bob: PublicUser;

beforeEach(async () => {
  useFreshDb();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(fixture)));
  alice = await createUser({ email: "alice@example.com", name: "Alice", password: "password123" });
  bob = await createUser({ email: "bob@example.com", name: "Bob", password: "password123" });
  session.user = alice;
});

async function newProject(name = "Thesis"): Promise<string> {
  const response = await projectsRoute.POST(request("POST", { name }), undefined);
  expect(response.status).toBe(201);
  return ((await response.json()) as { project: { id: string } }).project.id;
}

async function newSearch(body: Record<string, unknown> = {}): Promise<string> {
  const response = await searchesRoute.POST(request("POST", { question: "Does creatine improve cognition?", ...body }), undefined);
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

const pdfBytes = new TextEncoder().encode("%PDF-1.4\n% test document\n");
function fileForm(bytes: Uint8Array | string, name = "paper.pdf", type = "application/pdf"): FormData {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], name, { type }));
  return form;
}
const meta = { title: "Uploaded study", authors: ["Me"], year: 2024, venue: null, doi: "https://doi.org/10.9/z", abstract: "An abstract." };

describe("request checks", () => {
  it("rejects signed-out requests and cross-origin writes", async () => {
    session.user = null;
    expect((await searchesRoute.POST(request("POST", { question: "Valid question?" }), undefined)).status).toBe(401);
    session.user = alice;
    const crossOrigin = request("POST", { question: "Valid question?" }, { origin: "https://evil.example" });
    expect((await searchesRoute.POST(crossOrigin, undefined)).status).toBe(403);
  });

  it("validates input", async () => {
    const short = await searchesRoute.POST(request("POST", { question: "hi" }), undefined);
    expect(short.status).toBe(400);
    expect(((await short.json()) as { error: string }).error).toMatch(/at least 5/);
    const badYears = await searchesRoute.POST(
      request("POST", { question: "Valid question?", filters: { yearFrom: 2022, yearTo: 2020 } }),
      undefined,
    );
    expect(badYears.status).toBe(400);
    expect((await projectsRoute.POST(request("POST", { name: " " }), undefined)).status).toBe(400);
  });
});

describe("projects", () => {
  it("creates, renames and deletes projects, hiding them from others", async () => {
    const id = await newProject();
    expect((await projectRoute.PATCH(request("PATCH", { name: "Renamed", description: "About sleep" }), ctx({ id }))).status).toBe(200);
    expect(listProjects(alice.id)[0]).toMatchObject({ name: "Renamed", description: "About sleep" });
    session.user = bob;
    expect((await projectRoute.DELETE(request("DELETE"), ctx({ id }))).status).toBe(404);
    session.user = alice;
    expect((await projectRoute.DELETE(request("DELETE"), ctx({ id }))).status).toBe(204);
    expect(listProjects(alice.id)).toEqual([]);
  });
});

describe("searches", () => {
  it("plans a query, applies filters, and files the search in the chosen project", async () => {
    const projectId = await newProject();
    const id = await newSearch({ projectId, filters: { yearFrom: 2018, types: ["review"] } });
    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string);
    expect(url.searchParams.get("search")).toBe("planned: Does creatine improve cognition");
    expect(url.searchParams.get("filter")).toContain("publication_year:>2017");
    expect(url.searchParams.get("filter")).toContain("type:review");
    const bundle = getSearchBundle(alice.id, id)!;
    expect(bundle.search).toMatchObject({ projectId, filters: { yearFrom: 2018, types: ["review"] } });
    expect(bundle.papers).toHaveLength(fixture.results.length);
  });

  it("creates a default project when none is given", async () => {
    const id = await newSearch();
    const [project] = listProjects(alice.id);
    expect(project.name).toBe("My research");
    expect(getSearchBundle(alice.id, id)!.search.projectId).toBe(project.id);
  });

  it("rejects other users' projects and searches", async () => {
    const projectId = await newProject();
    const id = await newSearch({ projectId });
    session.user = bob;
    expect((await searchesRoute.POST(request("POST", { question: "Valid question?", projectId }), undefined)).status).toBe(404);
    expect((await searchRoute.GET(request("GET"), ctx({ id }))).status).toBe(404);
    expect((await columnsRoute.POST(request("POST", { name: "X" }), ctx({ id }))).status).toBe(404);
    expect((await exportRoute.GET(request("GET"), ctx({ id }))).status).toBe(404);
    expect((await chatsRoute.POST(request("POST", { projectId, mode: "search" }), undefined)).status).toBe(404);
  });

  it("retries with the raw question, and reports search outages", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ meta: { count: 0 }, results: [] }))
      .mockResolvedValueOnce(Response.json(fixture));
    const id = await newSearch();
    expect(getSearchBundle(alice.id, id)!.search.searchQuery).toBe("Does creatine improve cognition?");
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 429 }));
    expect((await searchesRoute.POST(request("POST", { question: "Valid question?" }), undefined)).status).toBe(502);
  });

  it("renames and deletes searches", async () => {
    const id = await newSearch();
    expect((await searchRoute.PATCH(request("PATCH", { question: "New title" }), ctx({ id }))).status).toBe(204);
    expect(getSearchBundle(alice.id, id)!.search.question).toBe("New title");
    expect((await searchRoute.DELETE(request("DELETE"), ctx({ id }))).status).toBe(204);
    expect(getSearchBundle(alice.id, id)).toBeNull();
  });

  it("loads the next page without duplicating papers", async () => {
    const id = await newSearch();
    const body = (await (await moreRoute.POST(request("POST"), ctx({ id }))).json()) as { papers: unknown[]; hasMore: boolean };
    expect(body).toEqual({ papers: [], hasMore: false });
    expect(getSearchBundle(alice.id, id)!.search.nextPage).toBe(3);
  });
});

describe("columns, extraction and screening", () => {
  it("adds and removes columns", async () => {
    const id = await newSearch();
    expect((await columnsRoute.POST(request("POST", { name: "  " }), ctx({ id }))).status).toBe(400);
    const added = await columnsRoute.POST(request("POST", { name: "Dosage", instructions: "Daily dose" }), ctx({ id }));
    const { column } = (await added.json()) as { column: { id: string } };
    expect((await columnRoute.DELETE(request("DELETE"), ctx({ id, columnId: column.id }))).status).toBe(204);
    expect((await columnRoute.DELETE(request("DELETE"), ctx({ id, columnId: column.id }))).status).toBe(404);
  });

  it("extracts the requested columns and maps AI errors", async () => {
    const id = await newSearch();
    const { papers, columns } = getSearchBundle(alice.id, id)!;
    ai.extractCells.mockImplementation(async ({ paper, columns: cols }) =>
      cols.map((c: { id: string }) => ({ paperId: paper.id, columnId: c.id, value: "v", quote: "q" })),
    );
    await extractRoute.POST(request("POST", { columnIds: [columns[1].id] }), ctx({ id, paperId: papers[0].id }));
    expect(getSearchBundle(alice.id, id)!.cells).toEqual([{ paperId: papers[0].id, columnId: columns[1].id, value: "v", quote: "q" }]);

    expect((await extractRoute.POST(request("POST", {}), ctx({ id, paperId: "nope" }))).status).toBe(404);
    ai.extractCells.mockRejectedValue(new AiRefusalError());
    expect((await extractRoute.POST(request("POST", {}), ctx({ id, paperId: papers[0].id }))).status).toBe(422);
    ai.extractCells.mockRejectedValue(new AiUnavailableError("Add GEMINI_API_KEY to .env.local and restart the server."));
    const unavailable = await extractRoute.POST(request("POST", {}), ctx({ id, paperId: papers[0].id }));
    expect(unavailable.status).toBe(503);
    expect(((await unavailable.json()) as { error: string }).error).toMatch(/GEMINI_API_KEY/);
  });

  it("screens against saved criteria and lets the user override", async () => {
    const id = await newSearch();
    const paperId = getSearchBundle(alice.id, id)!.papers[0].id;
    expect((await screenRoute.POST(request("POST"), ctx({ id, paperId }))).status).toBe(400);

    expect((await criteriaRoute.PUT(request("PUT", { criteria: ["x"] }), ctx({ id }))).status).toBe(400);
    expect((await criteriaRoute.PUT(request("PUT", { criteria: ["Adults only", "Randomized"] }), ctx({ id }))).status).toBe(200);
    ai.screenPaper.mockImplementation(async ({ paper, criteria }) => ({
      paperId: paper.id,
      decision: "maybe",
      reason: "Unclear",
      results: criteria.map((criterion: string) => ({ criterion, met: "unclear", note: "n" })),
      overridden: false,
    }));
    const screened = await screenRoute.POST(request("POST"), ctx({ id, paperId }));
    expect(((await screened.json()) as { screening: { decision: string } }).screening.decision).toBe("maybe");
    expect(ai.screenPaper.mock.calls[0][0].criteria).toEqual(["Adults only", "Randomized"]);

    await screenRoute.PATCH(request("PATCH", { decision: "include" }), ctx({ id, paperId }));
    expect(getSearchBundle(alice.id, id)!.screenings[0]).toMatchObject({ decision: "include", overridden: true, reason: "Unclear" });
    expect((await screenRoute.PATCH(request("PATCH", { decision: "nah" }), ctx({ id, paperId }))).status).toBe(400);
  });

  it("follows the citation trail into the table", async () => {
    const id = await newSearch();
    const paperId = getSearchBundle(alice.id, id)!.papers[0].id;
    const newWork = { ...fixture.results[0], id: "https://openalex.org/W999", display_name: "A citing paper" };
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ results: [newWork] }));
    const response = await trailRoute.POST(request("POST", { kind: "citing" }), ctx({ id, paperId }));
    expect(((await response.json()) as { papers: { title: string }[] }).papers.map((p) => p.title)).toEqual(["A citing paper"]);
    expect((await trailRoute.POST(request("POST", { kind: "sideways" }), ctx({ id, paperId }))).status).toBe(400);
  });
});

describe("uploads", () => {
  it("rejects non-PDFs", async () => {
    const id = await newSearch();
    expect((await uploadRoute.POST(request("POST", fileForm("hello")), ctx({ id }))).status).toBe(400);
    expect(ai.extractPdfMetadata).not.toHaveBeenCalled();
  });

  it("uploads, serves, extracts from, and deletes a PDF", async () => {
    const id = await newSearch();
    ai.extractPdfMetadata.mockResolvedValue(meta);
    const uploaded = await uploadRoute.POST(request("POST", fileForm(pdfBytes)), ctx({ id }));
    expect(uploaded.status).toBe(201);
    const { paper } = (await uploaded.json()) as { paper: { id: string; doi: string; hasPdf: boolean } };
    expect(paper).toMatchObject({ doi: "10.9/z", hasPdf: true });
    expect(uploads()).toHaveLength(1);

    const served = await pdfRoute.GET(request("GET"), ctx({ id, paperId: paper.id }));
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(pdfBytes);

    ai.extractCells.mockResolvedValue([]);
    await extractRoute.POST(request("POST", {}), ctx({ id, paperId: paper.id }));
    expect(ai.extractCells.mock.calls[0][0].pdf).toEqual(pdfBytes);

    expect((await paperRoute.DELETE(request("DELETE"), ctx({ id, paperId: paper.id }))).status).toBe(204);
    expect(uploads()).toHaveLength(0);
  });

  it("removes the stored file if reading the PDF fails", async () => {
    const id = await newSearch();
    ai.extractPdfMetadata.mockRejectedValue(new Error("model down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await uploadRoute.POST(request("POST", fileForm(pdfBytes)), ctx({ id }))).status).toBe(500);
    expect(uploads()).toHaveLength(0);
  });
});

describe("library", () => {
  it("saves from a table, reports it, and unsaves", async () => {
    const id = await newSearch();
    const paperId = getSearchBundle(alice.id, id)!.papers[0].id;
    expect((await libraryRoute.POST(request("POST", { searchId: id, paperId }), undefined)).status).toBe(201);
    expect((await libraryRoute.POST(request("POST", { searchId: id, paperId }), undefined)).status).toBe(200);
    const externalId = getSearchBundle(alice.id, id)!.savedExternalIds[0];
    expect(externalId).toMatch(/^W/);
    expect((await libraryRoute.DELETE(request("DELETE", { externalId }), undefined)).status).toBe(204);
    expect(listLibrary(alice.id)).toEqual([]);
  });

  it("keeps its own copy of a saved PDF", async () => {
    const id = await newSearch();
    ai.extractPdfMetadata.mockResolvedValue(meta);
    const uploaded = await uploadRoute.POST(request("POST", fileForm(pdfBytes)), ctx({ id }));
    const { paper } = (await uploaded.json()) as { paper: { id: string } };
    await libraryRoute.POST(request("POST", { searchId: id, paperId: paper.id }), undefined);
    expect(uploads()).toHaveLength(2);
    await paperRoute.DELETE(request("DELETE"), ctx({ id, paperId: paper.id }));
    expect(uploads()).toHaveLength(1);
    expect(listLibrary(alice.id)[0].hasPdf).toBe(true);
  });

  it("uploads, imports, tags, exports and deletes", async () => {
    ai.extractPdfMetadata.mockResolvedValue(meta);
    expect((await libraryUploadRoute.POST(request("POST", fileForm(pdfBytes)), undefined)).status).toBe(201);

    const bib = "@article{a, title={Imported one}, author={Smith, Jane}, year={2020}, doi={10.1/A}}\n@article{b, title={Imported two}}";
    const imported = await libraryImportRoute.POST(request("POST", fileForm(bib, "refs.bib", "text/plain")), undefined);
    expect(((await imported.json()) as { items: unknown[] }).items).toHaveLength(2);
    const again = await libraryImportRoute.POST(request("POST", fileForm(bib, "refs.bib", "text/plain")), undefined);
    // The DOI-identified paper is skipped; the one without a DOI is added again.
    expect(await again.json()).toMatchObject({ skipped: 1 });
    expect((await libraryImportRoute.POST(request("POST", fileForm("nothing", "x.bib", "text/plain")), undefined)).status).toBe(400);

    const item = listLibrary(alice.id).find((i) => i.title === "Imported one")!;
    const patched = await libraryItemRoute.PATCH(request("PATCH", { tags: ["Sleep", "sleep"], notes: "Key" }), ctx({ id: item.id }));
    expect(((await patched.json()) as { item: { tags: string[] } }).item.tags).toEqual(["sleep"]);

    const exportUrl = `http://localhost/api/library/export?format=ris&ids=${item.id}`;
    const ris = await (await libraryExportRoute.GET(request("GET", undefined, {}, exportUrl), undefined)).text();
    expect(ris).toContain("TI  - Imported one");
    expect(ris).not.toContain("Imported two");

    session.user = bob;
    expect((await libraryItemRoute.DELETE(request("DELETE"), ctx({ id: item.id }))).status).toBe(404);
    session.user = alice;
    expect((await libraryItemRoute.DELETE(request("DELETE"), ctx({ id: item.id }))).status).toBe(204);
  });

  it("builds a table from library papers", async () => {
    const id = await newSearch();
    const paperId = getSearchBundle(alice.id, id)!.papers[0].id;
    await libraryRoute.POST(request("POST", { searchId: id, paperId }), undefined);
    const projectId = await newProject("From library");
    const itemIds = listLibrary(alice.id).map((item) => item.id);
    const response = await manualRoute.POST(request("POST", { projectId, title: "My picks", libraryItemIds: itemIds }), undefined);
    const { id: tableId } = (await response.json()) as { id: string };
    const bundle = getSearchBundle(alice.id, tableId)!;
    expect(bundle.search).toMatchObject({ kind: "manual", question: "My picks", projectId });
    expect(bundle.papers).toHaveLength(1);
    expect((await moreRoute.POST(request("POST"), ctx({ id: tableId }))).status).toBe(400);
  });
});

describe("summary, report and export", () => {
  it("streams the summary and saves it", async () => {
    const id = await newSearch();
    ai.summarize.mockImplementation(async (_q, papers, onEvent) => {
      onEvent({ type: "segment" });
      onEvent({ type: "text", text: "It may help." });
      return { ...cited, paperIds: papers.map((p: { id: string }) => p.id), createdAt: 1 };
    });
    const response = await summaryRoute.POST(request("POST"), ctx({ id }));
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect((await events(response)).map((e) => e.type)).toEqual(["segment", "text", "done"]);
    expect(getSearchBundle(alice.id, id)!.search.summary?.segments[0].text).toBe("It may help.");
  });

  it("streams an error event when the model fails", async () => {
    const id = await newSearch();
    ai.summarize.mockRejectedValue(new AiRefusalError());
    expect(await events(await summaryRoute.POST(request("POST"), ctx({ id })))).toEqual([
      { type: "error", message: "The AI model declined to answer this request." },
    ]);
  });

  it("writes the report from screened-in papers when there are any", async () => {
    const id = await newSearch();
    const { papers } = getSearchBundle(alice.id, id)!;
    await criteriaRoute.PUT(request("PUT", { criteria: ["Adults only"] }), ctx({ id }));
    await screenRoute.PATCH(request("PATCH", { decision: "include" }), ctx({ id, paperId: papers[1].id }));
    ai.writeReport.mockResolvedValue({ ...cited, paperIds: [], createdAt: 1 });
    await (await reportRoute.POST(request("POST"), ctx({ id }))).text();
    expect(ai.writeReport.mock.calls[0][0].papers.map((p: { id: string }) => p.id)).toEqual([papers[1].id]);
    expect(getSearchBundle(alice.id, id)!.search.report).not.toBeNull();
  });

  it("exports CSV, BibTeX and RIS", async () => {
    const id = await newSearch();
    const get = (format: string) => exportRoute.GET(request("GET", undefined, {}, `http://localhost/x?format=${format}`), ctx({ id }));
    const csv = await get("csv");
    expect(csv.headers.get("content-disposition")).toMatch(/not-elicit-does-creatine-improve-cognition\.csv/);
    expect((await csv.text()).split("\r\n")[0]).toContain("Title,Authors,Year");
    expect(await (await get("bibtex")).text()).toContain("@article{");
    expect(await (await get("ris")).text()).toContain("TY  - JOUR");
    expect((await get("docx")).status).toBe(400);
  });
});

describe("chats", () => {
  it("starts a chat with a table's papers, including PDF text", async () => {
    const projectId = await newProject();
    const id = await newSearch({ projectId });
    ai.extractPdfMetadata.mockResolvedValue(meta);
    await uploadRoute.POST(request("POST", fileForm(pdfBytes)), ctx({ id }));
    const response = await chatsRoute.POST(request("POST", { projectId, mode: "papers", search: { id } }), undefined);
    const { id: chatId } = (await response.json()) as { id: string };
    const bundle = getChatBundle(alice.id, chatId)!;
    expect(bundle.chat).toMatchObject({ mode: "papers", title: `Chat about ${fixture.results.length + 1} papers` });
    expect(bundle.sources.filter((s) => s.hasPdf)).toHaveLength(1);
    expect((await chatsRoute.POST(request("POST", { projectId, mode: "papers" }), undefined)).status).toBe(400);
  });

  it("research chats search for papers, then answer with history", async () => {
    const projectId = await newProject();
    const created = await chatsRoute.POST(request("POST", { projectId, mode: "search" }), undefined);
    const { id: chatId } = (await created.json()) as { id: string };
    ai.chatReply.mockImplementation(async (input, onEvent) => {
      onEvent({ type: "segment" });
      onEvent({ type: "citation", paperId: input.sources[0].id });
      onEvent({ type: "text", text: "Yes, modestly." });
      return { segments: [{ text: "Yes, modestly.", paperIds: [input.sources[0].id] }], model: "fake" };
    });

    const first = await events(await messagesRoute.POST(request("POST", { text: "Does creatine help memory?" }), ctx({ id: chatId })));
    expect(first.map((e) => e.type)).toEqual(["sources", "segment", "citation", "text", "done"]);
    expect(ai.planSearchQuery).toHaveBeenCalledWith("Does creatine help memory?", undefined);

    await events(await messagesRoute.POST(request("POST", { text: "In older adults?" }), ctx({ id: chatId })));
    expect(ai.planSearchQuery).toHaveBeenLastCalledWith("In older adults?", "- Does creatine help memory?");
    expect(ai.chatReply.mock.calls[1][0].history).toEqual([
      { role: "user", text: "Does creatine help memory?" },
      { role: "assistant", text: "Yes, modestly.[1]" },
    ]);

    const bundle = getChatBundle(alice.id, chatId)!;
    expect(bundle.chat.title).toBe("Does creatine help memory?");
    expect(bundle.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    // The fake search returns the same works both times, so sources aren't duplicated.
    expect(bundle.sources).toHaveLength(fixture.results.length);
  });

  it("renames and deletes chats, only for their owner", async () => {
    const projectId = await newProject();
    const created = await chatsRoute.POST(request("POST", { projectId, mode: "search" }), undefined);
    const { id: chatId } = (await created.json()) as { id: string };
    expect((await messagesRoute.POST(request("POST", { text: " " }), ctx({ id: chatId }))).status).toBe(400);
    expect((await chatRoute.PATCH(request("PATCH", { title: "Renamed" }), ctx({ id: chatId }))).status).toBe(204);
    session.user = bob;
    expect((await chatRoute.DELETE(request("DELETE"), ctx({ id: chatId }))).status).toBe(404);
    expect((await messagesRoute.POST(request("POST", { text: "Hi" }), ctx({ id: chatId }))).status).toBe(404);
    session.user = alice;
    expect((await chatRoute.DELETE(request("DELETE"), ctx({ id: chatId }))).status).toBe(204);
    expect(getChatBundle(alice.id, chatId)).toBeNull();
  });
});

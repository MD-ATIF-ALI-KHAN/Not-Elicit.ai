import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate, MIGRATIONS, setDbForTesting } from "@/lib/db";
import { bundleToCsv } from "@/lib/formats";
import {
  addAssistantMessage,
  addSources,
  addUserMessage,
  createChat,
  getChat,
  getChatBundle,
  listChats,
  sourcesForModel,
} from "@/lib/repo/chats";
import {
  addToLibrary,
  cleanTags,
  deleteLibraryItem,
  findByExternalId,
  listLibrary,
  removeByExternalId,
  updateLibraryItem,
} from "@/lib/repo/library";
import { createProject, defaultProject, deleteProject, getProject, listProjects, updateProject } from "@/lib/repo/projects";
import {
  addColumn,
  addPapers,
  createSearch,
  DEFAULT_COLUMNS,
  deleteColumn,
  deletePaper,
  deleteSearch,
  getPaperPdfFile,
  getScreening,
  getSearch,
  getSearchBundle,
  listSearches,
  saveCells,
  saveCriteria,
  saveReport,
  saveScreening,
  saveSummary,
  workToPaperInput,
  type PaperInput,
} from "@/lib/repo/searches";
import { authenticate, createSession, createUser, deleteSession, EmailTakenError, userForSessionToken } from "@/lib/users";
import { useFreshDb, work } from "./helpers";

beforeEach(useFreshDb);

const PDF_A = "00000000-0000-0000-0000-00000000000a.pdf";

function upload(title: string, pdfFile = PDF_A): PaperInput {
  return {
    source: "upload",
    externalId: null,
    title,
    authors: ["Me"],
    year: 2024,
    venue: null,
    doi: "10.5/y",
    url: null,
    pdfUrl: null,
    abstract: "A summary.",
    citedByCount: null,
    pdfFile,
  };
}

describe("users and sessions", () => {
  it("creates accounts and authenticates case-insensitively", async () => {
    const user = await createUser({ email: "Ada@Example.com", name: " Ada ", password: "password123" });
    expect(user).toMatchObject({ email: "ada@example.com", name: "Ada" });
    expect(await authenticate("ADA@example.com", "password123")).toEqual(user);
    expect(await authenticate("ada@example.com", "wrong-password")).toBeNull();
    expect(await authenticate("nobody@example.com", "password123")).toBeNull();
  });

  it("rejects duplicate emails", async () => {
    await createUser({ email: "a@example.com", name: "A", password: "password123" });
    await expect(createUser({ email: "A@EXAMPLE.COM", name: "B", password: "password123" })).rejects.toBeInstanceOf(EmailTakenError);
  });

  it("resolves and revokes session tokens", async () => {
    const user = await createUser({ email: "a@example.com", name: "A", password: "password123" });
    const { token } = createSession(user.id);
    expect(userForSessionToken(token)).toEqual(user);
    expect(userForSessionToken("forged-token")).toBeNull();
    deleteSession(token);
    expect(userForSessionToken(token)).toBeNull();
  });
});

describe("data", () => {
  let alice: string;
  let bob: string;

  beforeEach(async () => {
    alice = (await createUser({ email: "alice@example.com", name: "Alice", password: "password123" })).id;
    bob = (await createUser({ email: "bob@example.com", name: "Bob", password: "password123" })).id;
  });

  function newSearch(userId = alice, papers: PaperInput[] = [work(1), work(2), work(3)].map(workToPaperInput)) {
    const project = defaultProject(userId);
    return createSearch({ userId, projectId: project.id, question: "Does creatine help memory?", searchQuery: "creatine memory", papers, totalResults: 100 });
  }

  describe("projects", () => {
    it("creates, lists with counts, updates and isolates projects", () => {
      const project = createProject(alice, "Thesis", "Chapter 2");
      createSearch({ userId: alice, projectId: project.id, question: "Q1", searchQuery: "q", papers: [], totalResults: 0 });
      createChat(project.id, "Chat", "search");
      expect(listProjects(alice)).toEqual([expect.objectContaining({ id: project.id, name: "Thesis", searchCount: 1, chatCount: 1 })]);
      updateProject(project.id, { name: "Thesis v2" });
      expect(getProject(alice, project.id)?.name).toBe("Thesis v2");
      expect(getProject(bob, project.id)).toBeNull();
      expect(listProjects(bob)).toEqual([]);
    });

    it("creates a default project only when needed", () => {
      const first = defaultProject(alice);
      expect(first.name).toBe("My research");
      expect(defaultProject(alice).id).toBe(first.id);
    });

    it("deletes searches and chats with the project and reports their PDFs", () => {
      const project = createProject(alice, "P");
      const searchId = createSearch({ userId: alice, projectId: project.id, question: "Q", searchQuery: "", papers: [upload("Mine")], totalResults: null });
      createChat(project.id, "C", "search");
      expect(deleteProject(bob, project.id)).toBeNull();
      expect(deleteProject(alice, project.id)).toEqual([PDF_A]);
      expect(getSearch(alice, searchId)).toBeNull();
      expect(listChats(alice, project.id)).toEqual([]);
    });
  });

  describe("searches", () => {
    it("creates a search with papers in order and the default columns", () => {
      const id = newSearch();
      const bundle = getSearchBundle(alice, id)!;
      expect(bundle.search).toMatchObject({ kind: "search", question: "Does creatine help memory?", nextPage: 2, filters: {}, criteria: [] });
      expect(bundle.papers.map((p) => p.title)).toEqual(["Paper 1", "Paper 2", "Paper 3"]);
      expect(bundle.columns.map((c) => c.name)).toEqual(DEFAULT_COLUMNS.map((c) => c.name));
      expect(listSearches(alice)).toEqual([expect.objectContaining({ id, paperCount: 3 })]);
    });

    it("never exposes one user's search to another", () => {
      const id = newSearch();
      expect(getSearch(bob, id)).toBeNull();
      expect(getSearchBundle(bob, id)).toBeNull();
      expect(deleteSearch(bob, id)).toBeNull();
      expect(listSearches(bob)).toEqual([]);
    });

    it("adds only new papers and records the next page", () => {
      const id = newSearch();
      const added = addPapers(id, [work(3), work(4)].map(workToPaperInput), 3);
      expect(added.map((p) => [p.title, p.position])).toEqual([["Paper 4", 3]]);
      expect(getSearch(alice, id)!.nextPage).toBe(3);
      const [mine] = addPapers(id, [upload("Mine")]);
      expect(mine).toMatchObject({ source: "upload", hasPdf: true, url: "https://doi.org/10.5/y" });
      expect(getPaperPdfFile(id, mine.id)).toBe(PDF_A);
    });

    it("saves cells, summary, report and criteria", () => {
      const id = newSearch();
      const { papers, columns } = getSearchBundle(alice, id)!;
      saveCells([{ paperId: papers[0].id, columnId: columns[0].id, value: "v1", quote: "q1" }]);
      saveCells([{ paperId: papers[0].id, columnId: columns[0].id, value: "v2", quote: "q2" }]);
      const summary = { segments: [{ text: "Yes.", paperIds: [] }], paperIds: [], model: "m", createdAt: 1 };
      saveSummary(id, summary);
      saveReport(id, { ...summary, segments: [{ text: "## Overview", paperIds: [] }] });
      saveCriteria(id, ["Adults only"]);
      const bundle = getSearchBundle(alice, id)!;
      expect(bundle.cells).toEqual([{ paperId: papers[0].id, columnId: columns[0].id, value: "v2", quote: "q2" }]);
      expect(bundle.search.summary?.segments[0].text).toBe("Yes.");
      expect(bundle.search.report?.segments[0].text).toBe("## Overview");
      expect(bundle.search.criteria).toEqual(["Adults only"]);

      expect(deleteColumn(id, columns[0].id)).toBe(true);
      expect(getSearchBundle(alice, id)!.cells).toEqual([]);
      expect(addColumn(id, "Dosage", "Daily dose").position).toBe(DEFAULT_COLUMNS.length);
    });

    it("stores screening decisions and deletes them with the paper", () => {
      const id = newSearch();
      const paperId = getSearchBundle(alice, id)!.papers[0].id;
      const screening = {
        paperId,
        decision: "maybe" as const,
        reason: "Unclear age",
        results: [{ criterion: "Adults", met: "unclear" as const, note: "Not stated" }],
        overridden: false,
      };
      saveScreening(screening);
      saveScreening({ ...screening, decision: "include", overridden: true });
      expect(getScreening(paperId)).toMatchObject({ decision: "include", overridden: true, results: screening.results });
      expect(getSearchBundle(alice, id)!.screenings).toHaveLength(1);
      expect(deletePaper(id, paperId)).toBeNull();
      expect(getScreening(paperId)).toBeNull();
    });

    it("reports which papers are already in the library", () => {
      const id = newSearch();
      addToLibrary(alice, { ...work(2), pdfFile: null });
      addToLibrary(bob, { ...work(3), pdfFile: null });
      expect(getSearchBundle(alice, id)!.savedExternalIds).toEqual(["W2"]);
    });

    it("exports CSV with screening and quotes", () => {
      const id = newSearch(alice, [workToPaperInput(work(1, { title: 'Commas, and "quotes"' }))]);
      const bundle = getSearchBundle(alice, id)!;
      saveCells([{ paperId: bundle.papers[0].id, columnId: bundle.columns[0].id, value: "Helps", quote: "improved memory" }]);
      saveScreening({ paperId: bundle.papers[0].id, decision: "include", reason: "All met", results: [], overridden: false });
      const [header, row] = bundleToCsv(getSearchBundle(alice, id)!).trim().split("\r\n");
      expect(header).toContain("Screening,Screening reason,Abstract,Summary,Summary (supporting quote)");
      expect(row.startsWith('"Commas, and ""quotes""",Author 1,2021,')).toBe(true);
      expect(row).toContain("include,All met");
      expect(row).toContain("Helps,improved memory");
    });
  });

  describe("library", () => {
    it("saves papers once per external id and keeps users apart", () => {
      const first = addToLibrary(alice, { ...work(1), pdfFile: null, tags: [" Methods ", "methods", "To-Read"] });
      expect(first.created).toBe(true);
      expect(first.item.tags).toEqual(["methods", "to-read"]);
      expect(addToLibrary(alice, { ...work(1), pdfFile: null }).created).toBe(false);
      expect(addToLibrary(bob, { ...work(1), pdfFile: null }).created).toBe(true);
      expect(listLibrary(alice)).toHaveLength(1);
    });

    it("allows several uploads without external ids", () => {
      addToLibrary(alice, { ...work(1), externalId: null, pdfFile: PDF_A });
      addToLibrary(alice, { ...work(2), externalId: null, pdfFile: null });
      expect(listLibrary(alice).map((item) => item.hasPdf).sort()).toEqual([false, true]);
    });

    it("updates tags and notes, and removes items with their PDF", () => {
      const { item } = addToLibrary(alice, { ...work(1), pdfFile: PDF_A });
      expect(updateLibraryItem(bob, item.id, { notes: "hack" })).toBeNull();
      expect(updateLibraryItem(alice, item.id, { tags: ["A", "b"], notes: "Key paper" })).toMatchObject({ tags: ["a", "b"], notes: "Key paper" });
      expect(deleteLibraryItem(bob, item.id)).toBeUndefined();
      expect(deleteLibraryItem(alice, item.id)).toBe(PDF_A);
      expect(listLibrary(alice)).toEqual([]);
    });

    it("unsaves by external id", () => {
      addToLibrary(alice, { ...work(4), pdfFile: null });
      expect(findByExternalId(alice, "W4")).not.toBeNull();
      expect(removeByExternalId(alice, "W4")).toBeNull();
      expect(removeByExternalId(alice, "W4")).toBeUndefined();
    });

    it("cleans tags", () => {
      expect(cleanTags(["", " A ", "a", "b"])).toEqual(["a", "b"]);
    });
  });

  describe("chats", () => {
    const source = (n: number, fullText: string | null = null) => ({
      externalId: `W${n}`,
      title: `Paper ${n}`,
      authors: ["A"],
      year: 2020,
      venue: null,
      url: null,
      abstract: `Abstract ${n}`,
      fullText,
    });

    it("numbers sources, skips duplicates and stores messages", () => {
      const project = defaultProject(alice);
      const chat = createChat(project.id, "About creatine", "papers", [source(1), source(2, "Full text")]);
      expect(addSources(chat.id, [source(2), source(3)])).toHaveLength(1);
      expect(sourcesForModel(chat.id).map((s) => [s.position, s.title, s.fullText])).toEqual([
        [1, "Paper 1", null],
        [2, "Paper 2", "Full text"],
        [3, "Paper 3", null],
      ]);

      addUserMessage(chat.id, "What do they find?");
      const ids = sourcesForModel(chat.id).map((s) => s.id);
      addAssistantMessage(chat.id, [{ text: "Memory improves", paperIds: [ids[0]] }], "model-x");
      const bundle = getChatBundle(alice, chat.id)!;
      expect(bundle.projectName).toBe("My research");
      expect(bundle.sources.map((s) => s.hasPdf)).toEqual([false, true, false]);
      expect(bundle.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(bundle.messages[1]).toMatchObject({ segments: [{ text: "Memory improves", paperIds: [ids[0]] }], model: "model-x" });
      expect(listChats(alice, project.id)).toEqual([expect.objectContaining({ id: chat.id, messageCount: 2 })]);
    });

    it("hides other users' chats", () => {
      const chat = createChat(defaultProject(alice).id, "Mine", "search");
      expect(getChat(bob, chat.id)).toBeNull();
      expect(getChatBundle(bob, chat.id)).toBeNull();
      expect(listChats(bob, chat.projectId)).toEqual([]);
    });
  });
});

describe("migration from v1", () => {
  it("moves existing per-question projects into a default project as searches", async () => {
    // Build a database at schema v1 (the first migration only) with one old-style project.
    const v1 = new DatabaseSync(":memory:");
    v1.exec("PRAGMA foreign_keys = ON");
    v1.exec(MIGRATIONS[0]);
    v1.exec("PRAGMA user_version = 1");
    v1.exec(`INSERT INTO users VALUES ('u1','a@b.c','A','h',1);
      INSERT INTO projects (id,user_id,question,search_query,created_at,updated_at) VALUES ('s1','u1','Old question','q',1,5);
      INSERT INTO papers (id,project_id,source,title,position,created_at) VALUES ('p1','s1','openalex','T',0,1);
      INSERT INTO extraction_columns (id,project_id,name,position,created_at) VALUES ('c1','s1','N',0,1);
      INSERT INTO cells VALUES ('p1','c1','v','q',1);`);
    migrate(v1);
    setDbForTesting(v1);

    const [project] = listProjects("u1");
    expect(project).toMatchObject({ name: "My research", searchCount: 1 });
    const bundle = getSearchBundle("u1", "s1")!;
    expect(bundle.search).toMatchObject({ projectId: project.id, kind: "search", question: "Old question", filters: {} });
    expect(bundle.cells).toHaveLength(1);
    expect(v1.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

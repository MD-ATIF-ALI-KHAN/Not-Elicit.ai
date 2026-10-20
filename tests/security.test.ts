import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseBibtex, parseRis } from "@/lib/formats";
import { normalizeWork } from "@/lib/openalex";
import { allowAttempt, resetAttempts } from "@/lib/rate-limit";
import { addToLibrary } from "@/lib/repo/library";
import { safeUrl } from "@/lib/text";
import { createUser, signupsOpen } from "@/lib/users";
import { useFreshDb } from "./helpers";

describe("safeUrl", () => {
  it("allows http and https only", () => {
    expect(safeUrl("https://doi.org/10.1/x")).toBe("https://doi.org/10.1/x");
    expect(safeUrl(" http://example.com/a ")).toBe("http://example.com/a");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });

  it("is applied to imported references and OpenAlex records", () => {
    expect(parseBibtex("@article{a, title={T}, url={javascript:alert(1)}}")[0].url).toBeNull();
    expect(parseRis("TY  - JOUR\nTI  - T\nUR  - javascript:alert(1)\nER  - ")[0].url).toBeNull();
    const work = normalizeWork({ id: "https://openalex.org/W1", primary_location: { landing_page_url: "javascript:x" } });
    expect(work.url).toBe("https://openalex.org/W1");
  });

  it("is applied when saving to the library", async () => {
    useFreshDb();
    const user = await createUser({ email: "a@example.com", name: "A", password: "password123" });
    const { item } = addToLibrary(user.id, {
      externalId: null,
      title: "T",
      authors: [],
      year: null,
      venue: null,
      doi: null,
      url: "javascript:alert(document.cookie)",
      pdfUrl: "vbscript:x",
      abstract: null,
      citedByCount: null,
      pdfFile: null,
    });
    expect(item.url).toBeNull();
    expect(item.pdfUrl).toBeNull();
  });
});

describe("allowAttempt", () => {
  it("limits attempts within a window and resets", () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(allowAttempt(key, 3, 1000, 0)).toBe(true);
    expect(allowAttempt(key, 3, 1000, 10)).toBe(false);
    expect(allowAttempt(key, 3, 1000, 2000)).toBe(true);
    resetAttempts(key);
    expect(allowAttempt(key, 1, 1000, 2001)).toBe(true);
  });
});

describe("signupsOpen", () => {
  beforeEach(useFreshDb);

  it("stays open unless DISABLE_SIGNUPS is true, and always allows the first account", async () => {
    expect(signupsOpen()).toBe(true);
    vi.stubEnv("DISABLE_SIGNUPS", "true");
    expect(signupsOpen()).toBe(true);
    await createUser({ email: "owner@example.com", name: "Owner", password: "password123" });
    expect(signupsOpen()).toBe(false);
    vi.unstubAllEnvs();
    expect(signupsOpen()).toBe(true);
  });
});

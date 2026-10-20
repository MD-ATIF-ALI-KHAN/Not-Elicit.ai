import { describe, expect, it } from "vitest";
import { formatAuthors, quoteIsInText, toCsv } from "@/lib/text";

describe("quoteIsInText", () => {
  const abstract = "Creatine (20 g/day) improved working memory in older adults, but effects on attention were small.";

  it("matches ignoring case, punctuation and spacing", () => {
    expect(quoteIsInText("improved WORKING memory in older adults", abstract)).toBe(true);
    expect(quoteIsInText("Creatine 20 g day improved", abstract)).toBe(true);
    expect(quoteIsInText("but effects on attention were small", abstract)).toBe(true);
  });

  it("treats ellipses as gaps only at the edges", () => {
    expect(quoteIsInText("…effects on attention were small.", abstract)).toBe(true);
  });

  it("rejects text that is not in the source", () => {
    expect(quoteIsInText("improved long-term memory", abstract)).toBe(false);
  });

  it("rejects very short or missing quotes and sources", () => {
    expect(quoteIsInText("small", abstract)).toBe(false);
    expect(quoteIsInText("improved working memory", null)).toBe(false);
  });
});

describe("formatAuthors", () => {
  it("lists a few authors and abbreviates long lists", () => {
    expect(formatAuthors([])).toBe("Unknown authors");
    expect(formatAuthors(["A", "B"])).toBe("A, B");
    expect(formatAuthors(["A", "B", "C", "D"], 2)).toBe("A, B et al.");
  });
});

describe("toCsv", () => {
  it("quotes fields containing commas, quotes and newlines", () => {
    expect(toCsv([["a,b", 'say "hi"', "two\nlines", 3, null]])).toBe('"a,b","say ""hi""","two\nlines",3,\r\n');
  });

  it("neutralizes spreadsheet formulas", () => {
    expect(toCsv([["=HYPERLINK(1)", "+1", "-2", "@x", "ok"]])).toBe("'=HYPERLINK(1),'+1,'-2,'@x,ok\r\n");
  });
});

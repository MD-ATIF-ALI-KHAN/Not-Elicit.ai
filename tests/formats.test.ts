import { describe, expect, it } from "vitest";
import { parseBibtex, parseReferences, parseRis, toBibtex, toRis, type Reference } from "@/lib/formats";

const ref: Reference = {
  title: "Creatine & Memory: 50% better?",
  authors: ["Ada Lovelace", "Alan Turing"],
  year: 2023,
  venue: "Journal of {Tests}",
  doi: "10.1000/xyz",
  url: "https://doi.org/10.1000/xyz",
  abstract: "Forty adults\ntook creatine.",
};

describe("BibTeX", () => {
  it("writes escaped entries with unique keys", () => {
    const bib = toBibtex([ref, { ...ref, title: "Creatine again" }]);
    expect(bib).toContain("@article{lovelace2023creatine,");
    expect(bib).toContain("@article{lovelace2023creatine2,");
    expect(bib).toContain("title = {Creatine \\& Memory: 50\\% better?}");
    expect(bib).toContain("author = {Ada Lovelace and Alan Turing}");
    expect(bib).toContain("journal = {Journal of Tests}");
    expect(bib).toContain("abstract = {Forty adults took creatine.}");
  });

  it("round-trips through the parser", () => {
    const [parsed] = parseBibtex(toBibtex([ref]));
    expect(parsed).toEqual({ ...ref, venue: "Journal of Tests", abstract: "Forty adults took creatine." });
  });

  it("reads typical reference-manager exports", () => {
    const bib = `
      @comment{Zotero export}
      @Article{smith2020,
        author    = {Smith, Jane and van der Berg, Piet},
        title     = {{Sleep} and {Memory} in {\\"O}lder Adults},
        journal   = "Sleep Research",
        year      = 2020,
        doi       = {https://doi.org/10.1/abc},
      }
      @inproceedings{lee2019, title={A conference paper}, booktitle={Proc. of Things}, year={2019}}
      @misc{notitle, author={Nobody}}`;
    expect(parseBibtex(bib)).toEqual([
      {
        title: "Sleep and Memory in Older Adults",
        authors: ["Jane Smith", "Piet van der Berg"],
        year: 2020,
        venue: "Sleep Research",
        doi: "10.1/abc",
        url: null,
        abstract: null,
      },
      { title: "A conference paper", authors: [], year: 2019, venue: "Proc. of Things", doi: null, url: null, abstract: null },
    ]);
  });
});

describe("RIS", () => {
  it("writes and parses records", () => {
    const ris = toRis([ref]);
    expect(ris).toContain("TY  - JOUR\r\nTI  - Creatine & Memory: 50% better?\r\nAU  - Ada Lovelace\r\nAU  - Alan Turing");
    expect(ris).toContain("AB  - Forty adults took creatine.");
    expect(parseRis(ris)).toEqual([{ ...ref, abstract: "Forty adults took creatine." }]);
  });

  it("reads alternative tags and skips untitled records", () => {
    const ris = ["TY  - JOUR", "T1  - Title one", "A1  - Smith, Jane", "Y1  - 2018/05/01/", "JF  - Journal", "N2  - Abstract text", "ER  - ", "TY  - GEN", "ER  - "].join("\n");
    expect(parseRis(ris)).toEqual([
      { title: "Title one", authors: ["Jane Smith"], year: 2018, venue: "Journal", doi: null, url: null, abstract: "Abstract text" },
    ]);
  });
});

describe("parseReferences", () => {
  it("detects the format", () => {
    expect(parseReferences(toRis([ref]))[0].title).toBe(ref.title);
    expect(parseReferences(toBibtex([ref]))[0].title).toBe(ref.title);
    expect(parseReferences("not a bibliography")).toEqual([]);
  });
});

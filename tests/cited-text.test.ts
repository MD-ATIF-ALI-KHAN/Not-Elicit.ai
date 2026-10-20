import { describe, expect, it } from "vitest";
import { parseBlocks, stripMath } from "@/components/CitedText";

describe("parseBlocks", () => {
  it("splits headings, paragraphs and lists", () => {
    const source = "## Overview\nCreatine may help\nolder adults.\n\n- First point\n- Second point\n\n1. One\n2. Two\n### Detail\nEnd.";
    expect(parseBlocks(source)).toEqual([
      { type: "heading", level: 2, text: "Overview" },
      { type: "paragraph", text: "Creatine may help older adults." },
      { type: "list", ordered: false, items: ["First point", "Second point"] },
      { type: "list", ordered: true, items: ["One", "Two"] },
      { type: "heading", level: 3, text: "Detail" },
      { type: "paragraph", text: "End." },
    ]);
  });

  it("keeps a citation that starts a line with the block before it", () => {
    // The private-use characters CitedText puts around a citation group index.
    const marker = "\uE0000\uE001";
    expect(parseBlocks(`- A finding\n${marker}\n\nNext`)).toEqual([
      { type: "list", ordered: false, items: [`A finding${marker}`] },
      { type: "paragraph", text: "Next" },
    ]);
  });
});

describe("stripMath", () => {
  it("removes LaTeX math delimiters but keeps money", () => {
    expect(stripMath("Cohen $d$ of -0.5 ($p < .001$), N = $N=160$.")).toBe("Cohen d of -0.5 (p < .001), N = N=160.");
    expect(stripMath("It costs $245 per patient, or $300 total.")).toBe("It costs $245 per patient, or $300 total.");
    expect(stripMath("A $50\%$ drop")).toBe("A $50\%$ drop");
    expect(stripMath("A $\alpha$ level")).toBe("A \alpha level");
  });
});

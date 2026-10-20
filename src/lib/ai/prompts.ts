// Prompts and output schemas for Not-Elicit.ai's AI features.

import { z } from "zod";
import { NOT_REPORTED } from "@/lib/text";
import type { Cell, ExtractionColumn, Paper } from "@/lib/types";

export function authorLine(paper: { authors: string[]; year: number | null }): string {
  const authors =
    paper.authors.length === 0
      ? "Unknown authors"
      : paper.authors.length > 2
        ? `${paper.authors[0]} et al.`
        : paper.authors.join(" & ");
  return paper.year ? `${authors}, ${paper.year}` : authors;
}

const GROUNDING = `Ground every claim in the provided sources and cite them. Do not use outside knowledge.
Describe the strength and consistency of the evidence: note when findings are mixed, preliminary, based on small samples, or come from reviews rather than primary studies.
Refer to "the papers" or "studies", never to "sources" or "search results".`;

// ---------------------------------------------------------------------------
// Search planning

export const SearchPlan = z.object({
  query: z.string().describe("A concise keyword query for a scholarly search engine, 3 to 10 words."),
});

export function searchPlanPrompt(question: string, context?: string): string {
  return (
    "Rewrite this research question as a keyword query for a scholarly search engine that matches " +
    "words in titles and abstracts. Keep the essential concepts and synonyms experts would use; " +
    "drop filler words." +
    (context ? `\n\nEarlier conversation, for context:\n${context}` : "") +
    `\n\nQuestion: ${question}`
  );
}

// ---------------------------------------------------------------------------
// Summary, report and chat

export const SUMMARY_SYSTEM = `You are Not-Elicit.ai, a research assistant that answers questions using only the academic papers provided.

Write a direct answer to the user's research question in one or two short paragraphs (roughly 120-250 words) of plain prose: no headings, no bullet points, no preamble.
${GROUNDING}
If the papers do not answer the question, say so plainly and describe what they do cover.`;

export const REPORT_SYSTEM = `You are Not-Elicit.ai, a research assistant writing a literature review report from the academic papers provided, including details already extracted from each paper.

Write a well-organised report in Markdown of roughly 500-900 words with exactly these sections, each starting with a "## " heading:
## Overview
## Key findings
## Study designs and evidence quality
## Disagreements and open questions
## Gaps and directions for future research

Use short paragraphs, and bullet lists where they help. ${GROUNDING}
Do not invent numbers; only report figures stated in the papers.`;

export const CHAT_SYSTEM = `You are Not-Elicit.ai, a friendly research assistant. You answer the user's questions using the academic papers provided, and you can discuss them across several turns.

Answer directly and concisely, using Markdown (short paragraphs, bullet lists when useful). ${GROUNDING}
If the papers don't contain the answer, say so plainly, and suggest what to search for instead.`;

/** How a paper is described to the model. */
export function sourceTitle(paper: { title: string; authors: string[]; year: number | null }): string {
  return `${paper.title} (${authorLine(paper)})`;
}

// ---------------------------------------------------------------------------
// Extraction table

export const ExtractionResult = z.object({
  answers: z.array(
    z.object({
      column_id: z.string(),
      value: z.string().describe(`A concise answer of at most about 40 words, or "${NOT_REPORTED}".`),
      supporting_quote: z
        .string()
        .describe("A short verbatim quote from the paper that supports the value, or an empty string."),
    }),
  ),
});

function paperIntro(paper: Paper, attached: boolean): string {
  return attached
    ? "Read the attached paper (full text)."
    : `Read this paper's abstract.\n\nTitle: ${paper.title}\nAuthors: ${authorLine(paper)}\nAbstract: ${paper.abstract || "(none)"}`;
}

export function buildExtractionPrompt(question: string, paper: Paper, columns: ExtractionColumn[], attached: boolean): string {
  const fields = columns
    .map((column) => `- column_id "${column.id}": ${column.name}${column.instructions ? ` — ${column.instructions}` : ""}`)
    .join("\n");
  return `${paperIntro(paper, attached)}

The user's research question is: ${question}

Extract the following fields from the paper. Return exactly one answer per column_id.
${fields}

Rules:
- Use only information stated in the paper. If a field is not reported, set value to "${NOT_REPORTED}" and supporting_quote to "".
- Keep each value concise and specific; include numbers when the paper reports them.
- supporting_quote must be copied verbatim from the paper text, short (one sentence or less).`;
}

/** Maps model answers onto the requested columns, ignoring unknown ids. */
export function cellsFromAnswers(
  paperId: string,
  columns: ExtractionColumn[],
  answers: { column_id: string; value: string; supporting_quote: string }[],
): Cell[] {
  return columns.map((column) => {
    const answer = answers.find((a) => a.column_id === column.id);
    return {
      paperId,
      columnId: column.id,
      value: answer?.value.trim() || NOT_REPORTED,
      quote: answer?.supporting_quote.trim() ?? "",
    };
  });
}

// ---------------------------------------------------------------------------
// Screening

export const ScreeningResult = z.object({
  criteria: z.array(
    z.object({
      index: z.number().int().describe("The criterion's number, starting at 1."),
      met: z.enum(["yes", "no", "unclear"]),
      note: z.string().describe("One short sentence explaining the judgement."),
    }),
  ),
});

export function buildScreeningPrompt(question: string, paper: Paper, criteria: string[], attached: boolean): string {
  return `${paperIntro(paper, attached)}

You are screening papers for a literature review on: ${question}

Judge whether the paper meets each inclusion criterion. Answer "yes" or "no" only when the paper makes it clear; otherwise "unclear".
${criteria.map((criterion, index) => `${index + 1}. ${criterion}`).join("\n")}`;
}

// ---------------------------------------------------------------------------
// Uploaded PDFs

export const PdfMetadata = z.object({
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  venue: z.string().nullable().describe("Journal, conference, or publisher, if stated."),
  doi: z.string().nullable().describe("The DOI without a https://doi.org/ prefix, if stated."),
  abstract: z
    .string()
    .describe("The paper's abstract verbatim. If it has none, a 3-5 sentence neutral summary of the paper."),
});

export type PdfMetadata = z.infer<typeof PdfMetadata>;

export const PDF_METADATA_PROMPT = "Extract the attached paper's bibliographic details and abstract.";

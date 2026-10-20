import "server-only";
import type { Cell, CriterionResult, ExtractionColumn, Paper, Screening, ScreeningDecision, Summary, SummarySegment } from "@/lib/types";
import { getProvider } from "./registry";
import { pdfTextForModel } from "./pdf";
import {
  buildExtractionPrompt,
  buildScreeningPrompt,
  cellsFromAnswers,
  CHAT_SYSTEM,
  ExtractionResult,
  PDF_METADATA_PROMPT,
  PdfMetadata,
  REPORT_SYSTEM,
  ScreeningResult,
  SearchPlan,
  searchPlanPrompt,
  sourceTitle,
  SUMMARY_SYSTEM,
} from "./prompts";
import type { CitedSource, SummaryEvent } from "./provider";

type OnEvent = (event: SummaryEvent) => void;

/** Characters of an uploaded PDF's text a chat keeps per source. */
const CHAT_PDF_CHARS = 20_000;

/**
 * A keyword query for OpenAlex. Falls back to the question itself if no model
 * is configured or the call fails, so search always works.
 */
export async function planSearchQuery(question: string, context?: string): Promise<string> {
  try {
    const plan = await getProvider().json(SearchPlan, { prompt: searchPlanPrompt(question, context) });
    return plan.query.trim() || question;
  } catch (error) {
    console.warn("Search planning failed; searching with the raw question.", error instanceof Error ? error.message : error);
    return question;
  }
}

function paperSource(paper: Paper, extra = ""): CitedSource {
  return {
    id: paper.id,
    title: sourceTitle(paper),
    url: paper.url,
    text: `${paper.abstract || "No abstract available."}${extra}`,
  };
}

export async function summarize(question: string, papers: Paper[], onEvent: OnEvent, signal?: AbortSignal): Promise<Summary> {
  const { segments, model } = await getProvider().streamCited(
    { system: SUMMARY_SYSTEM, prompt: `Research question: ${question}`, sources: papers.map((paper) => paperSource(paper)) },
    onEvent,
    signal,
  );
  return { segments, paperIds: papers.map((paper) => paper.id), model, createdAt: Date.now() };
}

export async function writeReport(
  input: { question: string; papers: Paper[]; columns: ExtractionColumn[]; cells: Cell[] },
  onEvent: OnEvent,
  signal?: AbortSignal,
): Promise<Summary> {
  const byKey = new Map(input.cells.map((cell) => [`${cell.paperId}:${cell.columnId}`, cell]));
  const sources = input.papers.map((paper) => {
    const details = input.columns
      .map((column) => {
        const cell = byKey.get(`${paper.id}:${column.id}`);
        return cell ? `- ${column.name}: ${cell.value}` : null;
      })
      .filter(Boolean);
    return paperSource(paper, details.length ? `\n\nExtracted details:\n${details.join("\n")}` : "");
  });
  const { segments, model } = await getProvider().streamCited(
    { system: REPORT_SYSTEM, prompt: `Write the report for this research question: ${input.question}`, sources },
    onEvent,
    signal,
  );
  return { segments, paperIds: input.papers.map((paper) => paper.id), model, createdAt: Date.now() };
}

export async function extractCells(input: {
  question: string;
  paper: Paper;
  columns: ExtractionColumn[];
  pdf?: Uint8Array;
}): Promise<Cell[]> {
  const { question, paper, columns, pdf } = input;
  if (columns.length === 0) return [];
  const result = await getProvider().json(ExtractionResult, {
    prompt: buildExtractionPrompt(question, paper, columns, Boolean(pdf)),
    pdf: pdf ? { data: pdf, title: paper.title } : undefined,
  });
  return cellsFromAnswers(paper.id, columns, result.answers);
}

export function extractPdfMetadata(pdf: Uint8Array, fileName: string): Promise<PdfMetadata> {
  return getProvider().json(PdfMetadata, { prompt: PDF_METADATA_PROMPT, pdf: { data: pdf, title: fileName } });
}

/** Include only when every criterion is met; exclude when any clearly is not. */
export function decide(results: CriterionResult[]): { decision: ScreeningDecision; reason: string } {
  const failed = results.filter((result) => result.met === "no");
  if (failed.length > 0) return { decision: "exclude", reason: failed.map((r) => `${r.criterion}: ${r.note}`).join(" ") };
  const unclear = results.filter((result) => result.met === "unclear");
  if (unclear.length > 0) return { decision: "maybe", reason: unclear.map((r) => `${r.criterion}: ${r.note}`).join(" ") };
  return { decision: "include", reason: "Meets every criterion." };
}

export async function screenPaper(input: {
  question: string;
  paper: Paper;
  criteria: string[];
  pdf?: Uint8Array;
}): Promise<Screening> {
  const { question, paper, criteria, pdf } = input;
  const result = await getProvider().json(ScreeningResult, {
    prompt: buildScreeningPrompt(question, paper, criteria, Boolean(pdf)),
    pdf: pdf ? { data: pdf, title: paper.title } : undefined,
  });
  const results: CriterionResult[] = criteria.map((criterion, index) => {
    const answer = result.criteria.find((c) => c.index === index + 1);
    return { criterion, met: answer?.met ?? "unclear", note: answer?.note.trim() ?? "Not assessed." };
  });
  return { paperId: paper.id, ...decide(results), results, overridden: false };
}

/** Rewrites an assistant answer as text with [n] markers, for conversation history. */
export function segmentsToMarkedText(segments: SummarySegment[], positionOf: (sourceId: string) => number | undefined): string {
  return segments
    .map((segment) => {
      const numbers = segment.paperIds.map(positionOf).filter((n): n is number => n !== undefined);
      return numbers.length ? `${segment.text}[${numbers.join(", ")}]` : segment.text;
    })
    .join("");
}

export interface ChatSourceText {
  id: string;
  position: number;
  title: string;
  authors: string[];
  year: number | null;
  url: string | null;
  abstract: string | null;
  fullText: string | null;
}

export async function chatReply(
  input: { history: { role: "user" | "assistant"; text: string }[]; message: string; sources: ChatSourceText[] },
  onEvent: OnEvent,
  signal?: AbortSignal,
): Promise<{ segments: SummarySegment[]; model: string }> {
  // Sources keep their chat-wide numbers, so pad gaps with placeholders that
  // carry no text; this keeps [n] in earlier answers meaningful.
  const sources: CitedSource[] = input.sources.map((source) => ({
    id: source.id,
    title: sourceTitle(source),
    url: source.url,
    text: source.fullText
      ? `Abstract: ${source.abstract || "(none)"}\n\nFull text:\n${source.fullText}`
      : source.abstract || "No abstract available.",
  }));
  return getProvider().streamCited(
    { system: CHAT_SYSTEM, history: input.history, prompt: input.message, sources },
    onEvent,
    signal,
  );
}

/** Extracted PDF text for a chat source, or null when it can't be read. */
export async function pdfTextForChat(pdf: Uint8Array): Promise<string | null> {
  try {
    return (await pdfTextForModel(pdf, CHAT_PDF_CHARS)).text;
  } catch {
    return null;
  }
}

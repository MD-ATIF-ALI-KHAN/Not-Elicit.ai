"use client";

import { Fragment, type ReactNode } from "react";
import type { SummarySegment } from "@/lib/types";

// Citation groups are spliced into the text as private-use markers so the
// Markdown parser can treat them as inline tokens.
const OPEN = "\uE000";
const CLOSE = "\uE001";
// Bold (**x**), italic (*x*) and citation markers.
const INLINE = new RegExp(`(\\*\\*[^*]+\\*\\*|\\*[^*\\s][^*]*\\*|${OPEN}\\d+${CLOSE})`, "g");

/**
 * Drops LaTeX math delimiters models copy from abstracts ("$p < .001$",
 * "Cohen $d$") while leaving money ("$245") alone: math starts with a letter
 * or backslash, amounts with a digit.
 */
export function stripMath(text: string): string {
  return text.replace(/\$(?=[A-Za-z\\])([^$\n]{1,60}?)\$/g, (_, math: string) => math.replace(/\\([%&_#])/g, "$1"));
}

type Block =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "paragraph"; text: string };

/** Splits lightweight Markdown (headings, lists, paragraphs) into blocks. */
export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length <= 2 ? 2 : 3, text: heading[2] });
    } else if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const item = (bullet ?? numbered)![1];
      const last = blocks.at(-1);
      if (last?.type === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ type: "list", ordered, items: [item] });
    } else if (line.startsWith(OPEN) && blocks.at(-1) && !paragraph.length) {
      // A citation that landed on its own line belongs to the previous block.
      const last = blocks.at(-1)!;
      if (last.type === "list") last.items[last.items.length - 1] += line;
      else if (last.type === "paragraph" || last.type === "heading") last.text += line;
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

export function CitedText({
  segments,
  numberOf,
  onCite,
  streaming = false,
  className = "",
}: {
  segments: SummarySegment[];
  /** The number shown for a source, or null if it no longer exists. */
  numberOf: (sourceId: string) => number | null;
  onCite?: (sourceId: string) => void;
  streaming?: boolean;
  className?: string;
}) {
  const groups: string[][] = [];
  let source = "";
  for (const segment of segments) {
    source += segment.text;
    if (segment.paperIds.length > 0) {
      source += `${OPEN}${groups.length}${CLOSE}`;
      groups.push(segment.paperIds);
    }
  }

  const inline = (text: string): ReactNode[] =>
    text.split(INLINE).map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        return <em key={index}>{part.slice(1, -1)}</em>;
      }
      if (part.startsWith(OPEN)) {
        const ids = groups[Number(part.slice(1, -1))] ?? [];
        return (
          <Fragment key={index}>
            {ids.map((id) => {
              const number = numberOf(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => number !== null && onCite?.(id)}
                  disabled={number === null}
                  title={number === null ? "This source was removed" : `Go to source ${number}`}
                  className="mx-0.5 inline-flex min-w-5 -translate-y-0.5 items-center justify-center rounded bg-ink-100 px-1 align-baseline font-sans text-[0.7rem] font-semibold text-ink-800 hover:bg-ink-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  {number ?? "×"}
                </button>
              );
            })}
          </Fragment>
        );
      }
      return <Fragment key={index}>{part}</Fragment>;
    });

  const blocks = parseBlocks(stripMath(source));
  return (
    <div className={`space-y-3 ${className}`}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Tag = block.level === 2 ? "h3" : "h4";
          return (
            <Tag key={index} className="pt-2 font-serif text-lg font-semibold text-ink-950">
              {inline(block.text)}
            </Tag>
          );
        }
        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag key={index} className={`space-y-1 pl-6 ${block.ordered ? "list-decimal" : "list-disc"}`}>
              {block.items.map((item, i) => (
                <li key={i}>{inline(item)}</li>
              ))}
            </Tag>
          );
        }
        return <p key={index}>{inline(block.text)}</p>;
      })}
      {streaming && <span className="inline-block h-4 w-1.5 animate-pulse bg-ink-400 align-middle" />}
    </div>
  );
}

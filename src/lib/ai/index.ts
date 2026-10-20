import "server-only";

export { AiRateLimitError, AiRefusalError, AiRequestError, AiUnavailableError } from "./errors";
export {
  chatReply,
  decide,
  extractCells,
  extractPdfMetadata,
  pdfTextForChat,
  planSearchQuery,
  screenPaper,
  segmentsToMarkedText,
  summarize,
  writeReport,
} from "./features";
export type { ChatSourceText } from "./features";
export type { PdfMetadata } from "./prompts";
export type { AiProvider, SummaryEvent } from "./provider";
export { aiStatus, createProvider, getProvider, setProviderForTesting } from "./registry";

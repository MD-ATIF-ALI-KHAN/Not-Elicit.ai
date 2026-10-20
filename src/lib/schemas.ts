import { z } from "zod";

const currentYear = new Date().getFullYear();

/** Validates search filters sent by the client. */
export const SearchFiltersSchema = z
  .object({
    yearFrom: z.number().int().min(1900).max(currentYear + 1).optional(),
    yearTo: z.number().int().min(1900).max(currentYear + 1).optional(),
    minCitations: z.number().int().min(0).max(100000).optional(),
    openAccessOnly: z.boolean().optional(),
    types: z.array(z.string().max(40)).max(10).optional(),
  })
  .refine((f) => !f.yearFrom || !f.yearTo || f.yearFrom <= f.yearTo, "The start year must not be after the end year.");

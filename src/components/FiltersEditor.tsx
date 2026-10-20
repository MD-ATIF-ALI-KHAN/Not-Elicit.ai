"use client";

import type { SearchFilters } from "@/lib/types";

// Mirrors WORK_TYPES in lib/openalex.ts (kept separate so this stays client-safe).
const TYPES = [
  { id: "article", label: "Articles" },
  { id: "review", label: "Reviews" },
  { id: "preprint", label: "Preprints" },
  { id: "book-chapter", label: "Book chapters" },
  { id: "dissertation", label: "Dissertations" },
];

const numberInput =
  "mt-1 w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-ink-500 focus:ring-2 focus:ring-ink-200";

function toNumber(value: string): number | undefined {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function FiltersEditor({ value, onChange }: { value: SearchFilters; onChange: (filters: SearchFilters) => void }) {
  const set = (patch: Partial<SearchFilters>) => onChange({ ...value, ...patch });
  const types = value.types ?? [];
  return (
    <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 sm:grid-cols-2">
      <div>
        <span className="font-medium">Publication years</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder="From"
            aria-label="From year"
            value={value.yearFrom ?? ""}
            onChange={(e) => set({ yearFrom: toNumber(e.target.value) })}
            className={numberInput}
          />
          <span className="mt-1">–</span>
          <input
            type="number"
            placeholder="To"
            aria-label="To year"
            value={value.yearTo ?? ""}
            onChange={(e) => set({ yearTo: toNumber(e.target.value) })}
            className={numberInput}
          />
        </div>
      </div>
      <label className="block">
        <span className="font-medium">Minimum citations</span>
        <input
          type="number"
          min={0}
          placeholder="Any"
          value={value.minCitations ?? ""}
          onChange={(e) => set({ minCitations: toNumber(e.target.value) })}
          className={`${numberInput} block`}
        />
      </label>
      <fieldset>
        <legend className="font-medium">Publication types</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {TYPES.map((type) => (
            <label key={type.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={types.includes(type.id)}
                onChange={(e) =>
                  set({ types: e.target.checked ? [...types, type.id] : types.filter((t) => t !== type.id) })
                }
              />
              {type.label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">None selected means all types.</p>
      </fieldset>
      <label className="flex items-center gap-2 self-start pt-6">
        <input type="checkbox" checked={value.openAccessOnly ?? false} onChange={(e) => set({ openAccessOnly: e.target.checked })} />
        <span className="font-medium">Open access only</span>
      </label>
    </div>
  );
}

/** Short human description of active filters, e.g. "2018–2024 · reviews · ≥ 10 citations". */
export function describeFilters(filters: SearchFilters): string[] {
  const parts: string[] = [];
  if (filters.yearFrom && filters.yearTo) parts.push(`${filters.yearFrom}–${filters.yearTo}`);
  else if (filters.yearFrom) parts.push(`since ${filters.yearFrom}`);
  else if (filters.yearTo) parts.push(`until ${filters.yearTo}`);
  if (filters.types?.length) parts.push(filters.types.map((t) => TYPES.find((x) => x.id === t)?.label.toLowerCase() ?? t).join(", "));
  if (filters.minCitations) parts.push(`≥ ${filters.minCitations} citations`);
  if (filters.openAccessOnly) parts.push("open access");
  return parts;
}

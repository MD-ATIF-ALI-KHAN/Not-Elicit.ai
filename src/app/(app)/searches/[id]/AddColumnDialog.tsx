"use client";

import { useState } from "react";

const SUGGESTIONS: { name: string; instructions: string }[] = [
  { name: "Sample size", instructions: "The number of participants or samples analysed." },
  { name: "Intervention", instructions: "The treatment, exposure, or intervention studied, including dose and duration." },
  { name: "Outcome measures", instructions: "The outcomes measured and how they were measured." },
  { name: "Effect size", instructions: "Reported effect sizes, confidence intervals, or p-values for the main outcome." },
  { name: "Country", instructions: "The country or countries where the study was conducted." },
  { name: "Funding source", instructions: "Who funded the study, and any declared conflicts of interest." },
];

export function AddColumnDialog({
  existingNames,
  onAdd,
  onClose,
}: {
  existingNames: string[];
  onAdd: (name: string, instructions: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd(name.trim(), instructions.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the column.");
      setSaving(false);
    }
  }

  const suggestions = SUGGESTIONS.filter(
    (s) => !existingNames.some((existing) => existing.toLowerCase() === s.name.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="add-column-title">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink-950/30" />
      <form onSubmit={submit} className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <h2 id="add-column-title" className="font-serif text-xl font-semibold text-ink-950">
          Add a column
        </h2>
        <p className="mt-1 text-sm text-slate-600">Not-Elicit.ai will fill it in for every paper in the table.</p>

        {suggestions.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => {
                  setName(s.name);
                  setInstructions(s.instructions);
                }}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:border-ink-300 hover:text-ink-800"
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        <label className="mt-5 block text-sm font-medium text-slate-700">
          Column name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
            autoFocus
            placeholder="e.g. Dosage"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-ink-500 focus:ring-2 focus:ring-ink-200"
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          What should be extracted? <span className="font-normal text-slate-400">(optional)</span>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="e.g. The daily dose in grams and how long it was taken."
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-ink-500 focus:ring-2 focus:ring-ink-200"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-slate-700 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="rounded-lg bg-ink-800 px-4 py-2 font-medium text-white hover:bg-ink-900 disabled:opacity-60"
          >
            {saving ? "Adding…" : "Add column"}
          </button>
        </div>
      </form>
    </div>
  );
}

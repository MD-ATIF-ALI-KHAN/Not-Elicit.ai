"use client";

import { useEffect, type ReactNode } from "react";

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink-950/30" />
      <div className={`relative max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl ${wide ? "max-w-2xl" : "max-w-lg"}`}>
        <h2 className="font-serif text-xl font-semibold text-ink-950">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export const inputClass =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none " +
  "placeholder:text-slate-400 focus:border-ink-500 focus:ring-2 focus:ring-ink-200";

export const buttonPrimary =
  "rounded-lg bg-ink-800 px-4 py-2 font-medium text-white transition hover:bg-ink-900 disabled:opacity-60";

export const buttonSecondary =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60";

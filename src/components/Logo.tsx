import Link from "next/link";

export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#233564" />
      <path d="M8 8h3.6l7 10.4V8H22v16h-3.6l-7-10.4V24H8z" fill="#fbfaf7" />
      <circle cx="24" cy="23" r="3" fill="#f59e0b" />
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-serif text-xl font-semibold tracking-tight text-ink-900">
      <LogoMark />
      Not-Elicit.ai
    </Link>
  );
}

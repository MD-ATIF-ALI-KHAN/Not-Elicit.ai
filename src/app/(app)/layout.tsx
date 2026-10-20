import Link from "next/link";
import { logOut } from "@/app/(auth)/actions";
import { Logo } from "@/components/Logo";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <Logo href="/dashboard" />
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/dashboard" className="rounded-md px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 hover:text-ink-800">
                Projects
              </Link>
              <Link href="/library" className="rounded-md px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 hover:text-ink-800">
                Library
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-slate-600 sm:inline" title={user.email}>
              {user.name}
            </span>
            <form action={logOut}>
              <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50">
                Log out
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}

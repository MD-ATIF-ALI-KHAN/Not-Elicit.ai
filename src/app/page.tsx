import Link from "next/link";
import { Logo } from "@/components/Logo";
import { QuestionForm } from "@/components/QuestionForm";
import { getCurrentUser } from "@/lib/auth";

const STEPS = [
  {
    title: "Ask in plain language",
    body: "Type the question you are researching. Not-Elicit.ai turns it into a precise search across more than 250 million scholarly works indexed by OpenAlex.",
  },
  {
    title: "Read a cited answer",
    body: "An AI model reads the most relevant papers and writes a short synthesis. Every claim links back to the paper it came from.",
  },
  {
    title: "Compare studies in a table",
    body: "Study design, population, findings and limitations are pulled from each paper into one table. Add any column you need.",
  },
];

const FEATURES = [
  {
    title: "Citations you can check",
    body: "Answers cite specific papers, and each table cell carries a verbatim supporting quote. Quotes found word-for-word in the abstract are marked verified.",
  },
  {
    title: "Custom extraction columns",
    body: "Ask for anything — dosage, effect size, country, funding source — and Not-Elicit.ai fills the column for every paper.",
  },
  {
    title: "Bring your own PDFs",
    body: "Upload papers you already have. They join the table and are read in full text, not just the abstract.",
  },
  {
    title: "Export to CSV",
    body: "Take your table into a spreadsheet, a reference manager, or a systematic review workflow.",
  },
];

export default async function Home() {
  const user = await getCurrentUser();

  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-3 text-sm">
          {user ? (
            <Link href="/dashboard" className="rounded-lg bg-ink-800 px-4 py-2 font-medium text-white hover:bg-ink-900">
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="px-3 py-2 font-medium text-slate-700 hover:text-ink-800">
                Log in
              </Link>
              <Link href="/signup" className="rounded-lg bg-ink-800 px-4 py-2 font-medium text-white hover:bg-ink-900">
                Sign up free
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-6 pb-20 pt-16 text-center sm:pt-24">
          <p className="mb-4 inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-800">
            AI research assistant
          </p>
          <h1 className="font-serif text-4xl font-semibold leading-tight tracking-tight text-ink-950 sm:text-6xl">
            Research answers you can verify.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
            Not-Elicit.ai finds the academic papers behind your question, writes a cited summary, and lays out the
            evidence from every study side by side.
          </p>
          <div className="mt-10 text-left">
            <QuestionForm signedIn={Boolean(user)} />
          </div>
        </section>

        <section className="border-y border-slate-200 bg-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <div key={step.title}>
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-ink-100 font-serif text-lg font-semibold text-ink-800">
                  {index + 1}
                </div>
                <h2 className="font-serif text-xl font-semibold text-ink-950">{step.title}</h2>
                <p className="mt-2 text-slate-600">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-center font-serif text-3xl font-semibold text-ink-950">Built for evidence, not vibes</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="rounded-2xl border border-slate-200 bg-white p-6">
                <h3 className="font-semibold text-ink-900">{feature.title}</h3>
                <p className="mt-2 text-slate-600">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-ink-900">
          <div className="mx-auto flex max-w-4xl flex-col items-center px-6 py-16 text-center">
            <h2 className="font-serif text-3xl font-semibold text-white">Start your first literature review</h2>
            <p className="mt-3 text-ink-200">Free to try. Bring a question and see what the research says.</p>
            <Link
              href={user ? "/dashboard" : "/signup"}
              className="mt-8 rounded-lg bg-amber-400 px-6 py-3 font-semibold text-ink-950 hover:bg-amber-300"
            >
              {user ? "Open your dashboard" : "Create a free account"}
            </Link>
          </div>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-6 py-8 text-sm text-slate-500">
        <p>
          Not-Elicit.ai · Paper metadata from{" "}
          <a href="https://openalex.org" className="underline hover:text-slate-700">
            OpenAlex
          </a>
          . Works with Claude, Gemini, Groq, OpenRouter or a local model. AI can make mistakes — check the cited papers before relying on a result.
        </p>
      </footer>
    </div>
  );
}

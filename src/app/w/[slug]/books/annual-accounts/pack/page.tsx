import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { DownloadFile } from "@/components/download-csv";
import { EmptyState } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import type { NoteTable } from "@/lib/annual-notes";
import { cn } from "@/lib/cn";
import { todayIn } from "@/lib/dates";
import { loadBooks, yearLabel } from "../../data";
import { PrintButton } from "../../print-button";
import { Amount, StatementTable } from "../../statement-table";
import { longDate } from "../../statements/load";
import { approvalStands, loadAnnualAccounts, statusLine } from "../load";

export const metadata: Metadata = { title: "Annual accounts pack" };

function Paragraphs({ text }: { text: string }) {
  return <>{text.split(/\n{2,}/).map((p, i) => <p key={i} className="mb-3 whitespace-pre-line">{p}</p>)}</>;
}

function NoteTableView({ note, currency }: { note: NoteTable; currency: string }) {
  return (
    <div className="scroll-shadows overflow-x-auto overscroll-x-contain print:overflow-visible" tabIndex={0} role="region" aria-label={note.title}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-muted">
            <th scope="col" className="py-2 pr-3 font-normal"><span className="sr-only">Item</span></th>
            {note.columns.map((c) => <th key={c} scope="col" className="px-3 py-2 text-right font-normal last:pr-0">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {note.rows.map((r, i) => r.style === "heading" ? (
            <tr key={i}><th scope="colgroup" colSpan={note.columns.length + 1} className="pt-3 pb-1 text-left font-medium">{r.label}</th></tr>
          ) : (
            <tr key={i} className={cn("border-b border-line", r.style === "total" && "font-semibold")}>
              <th scope="row" className="py-2 pr-3 text-left font-[inherit]">{r.label}</th>
              {r.values.map((v, j) => <td key={j} className="px-3 py-2 text-right tabular last:pr-0"><Amount minor={v} currency={currency} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children, pageBreak }: { title: string; children: ReactNode; pageBreak?: boolean }) {
  return (
    <section className={cn("mb-10", pageBreak && "print:break-before-page")}>
      <h2 className="mb-4 font-display text-2xl font-medium">{title}</h2>
      {children}
    </section>
  );
}

async function Pack({ params, searchParams }: PageProps<"/w/[slug]/books/annual-accounts/pack">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, settings, years } = await loadBooks(slug);
  const base = `/w/${slug}/books`;
  if (!settings) return <EmptyState title="Set up the books first" action={<ButtonLink href={base}>Set up</ButtonLink>} />;
  const today = todayIn(business.timezone);
  const year = years.find((y) => y.id === sp.year && y.end_date < today);
  if (!year) notFound();
  const a = await loadAnnualAccounts(business, years, year);
  const s = a.saved;
  const cur = business.currency;
  const status = statusLine(s, year);
  let n = 0;
  const num = () => ++n;

  return (
    <article className="mx-auto max-w-4xl print:max-w-none">
      <div className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
        <ButtonLink href={`${base}/annual-accounts?year=${year.id}`} variant="ghost">Back to the annual accounts</ButtonLink>
        <PrintButton label="Print or save as PDF" />
        <DownloadFile href={`${base}/annual-accounts/export?year=${year.id}`} fallbackName={`annual-accounts-${yearLabel(year)}.xlsx`} label="Download Excel" type="spreadsheetml" />
      </div>

      {a.error ? (
        <p role="alert" className="rounded-[var(--radius-card)] bg-danger-soft p-4 text-danger">Couldn&rsquo;t build the accounts. Refresh to try again.</p>
      ) : (
        <>
          <header className="mb-12 border-b border-line pb-8">
            <p className="text-sm tracking-wide text-muted uppercase">Annual accounts</p>
            <h1 className="mt-2 font-display text-[clamp(2rem,1.5rem+2vw,3rem)] leading-[1.05] font-medium">{s?.company_name ?? business.name}</h1>
            {s?.rc_number && <p className="mt-1 text-muted">{s.rc_number}</p>}
            <p className="mt-4 text-lg">Financial statements {a.period}</p>
            <p className="mt-6 rounded-[var(--radius-card)] bg-ink/5 p-3 text-sm">{status}</p>
          </header>

          <Section title="Company information">
            <dl className="grid gap-4 sm:grid-cols-2">
              {[["Directors", s?.directors], ["Registered office", s?.registered_office], ["Principal activity", s?.principal_activity], ["Company registration", s?.rc_number]]
                .map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-sm text-muted">{label}</dt>
                    <dd className="whitespace-pre-line">{value || <span className="text-muted">Not entered</span>}</dd>
                  </div>
                ))}
            </dl>
          </Section>

          <Section title="Directors' approval">
            {approvalStands(s, year) ? (
              <p>The directors approved these financial statements on {longDate(s!.approved_on!)}. Signed on behalf of the board by {s!.approved_by}.</p>
            ) : (
              <p className="text-muted">Not yet approved by the directors.</p>
            )}
            <p className="mt-3 text-sm text-muted">The directors are responsible for preparing financial statements that give a true and fair view, under the IFRS for SMEs Accounting Standard.</p>
          </Section>

          {a.statements.map((st, i) => (
            <Section key={st.view} title={st.title} pageBreak={i === 0 || st.view === "cf"}>
              {st.built.checks.filter((c) => !c.ok).map((c) => <p key={c.label} role="alert" className="mb-3 text-danger">{c.label}</p>)}
              <StatementTable rows={st.built.rows} currency={cur} curLabel={a.curLabel} cmpLabel={a.prevLabel} caption={st.title} />
            </Section>
          ))}

          <Section title="Notes to the financial statements" pageBreak>
            {a.importedNote && <p className="mb-6 text-sm text-muted">{a.importedNote}</p>}
            <div className="mb-8">
              <h3 className="mb-2 font-medium">{num()}. Basis of preparation and accounting policies</h3>
              {a.policies ? <Paragraphs text={a.policies} /> : <p className="text-muted">Not written yet.</p>}
            </div>
            {s?.going_concern && (
              <div className="mb-8"><h3 className="mb-2 font-medium">{num()}. Going concern</h3><Paragraphs text={s.going_concern} /></div>
            )}
            {a.notes.map((note) => (
              <div key={note.key} className="mb-8 break-inside-avoid">
                <h3 className="mb-2 font-medium">{num()}. {note.title}</h3>
                <NoteTableView note={note} currency={cur} />
                {note.footnote && <p className="mt-2 text-sm text-muted">{note.footnote}</p>}
                {note.key === "share_capital" && s?.share_capital_note && <div className="mt-2"><Paragraphs text={s.share_capital_note} /></div>}
                {note.key === "directors" && s?.related_parties && <div className="mt-2"><Paragraphs text={s.related_parties} /></div>}
              </div>
            ))}
            {s?.related_parties && !a.notes.some((x) => x.key === "directors") && (
              <div className="mb-8"><h3 className="mb-2 font-medium">{num()}. Related parties</h3><Paragraphs text={s.related_parties} /></div>
            )}
            {s?.share_capital_note && !a.notes.some((x) => x.key === "share_capital") && (
              <div className="mb-8"><h3 className="mb-2 font-medium">{num()}. Share capital</h3><Paragraphs text={s.share_capital_note} /></div>
            )}
            <div className="mb-8">
              <h3 className="mb-2 font-medium">{num()}. Events after the year end</h3>
              {s?.events_after ? <Paragraphs text={s.events_after} /> : <p className="text-muted">Not written yet.</p>}
            </div>
            {s?.other_notes && <div className="mb-8"><h3 className="mb-2 font-medium">{num()}. Other notes</h3><Paragraphs text={s.other_notes} /></div>}
          </Section>

          <footer className="border-t border-line pt-4 text-sm text-muted">
            <p>{status}</p>
            <p className="print:hidden">The figures come from the books, so they change if anything in {yearLabel(year)} is changed. <Link className="underline" href={`${base}/trial-balance?year=${year.id}`}>Trial balance</Link></p>
          </footer>
        </>
      )}
    </article>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/annual-accounts/pack">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Pack {...props} />
    </Suspense>
  );
}

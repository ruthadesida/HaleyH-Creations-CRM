import { Wordmark } from "@/components/wordmark";

const STAGES = ["Enquiry", "Confirmed", "In production", "Quality check", "Dispatched", "Delivered"];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Brand panel: the seam, sewn through every stage of an order. */}
      <aside className="relative hidden overflow-hidden bg-ink p-12 text-ivory lg:flex lg:flex-col lg:justify-between">
        <Wordmark className="text-3xl" />
        <div>
          <p className="font-display max-w-md text-[clamp(2.25rem,1.5rem+2vw,3.5rem)] leading-[1.02] text-balance">
            Every order, from first message to delivered.
          </p>
          <ol className="mt-10" aria-label="Order stages">
            {STAGES.map((stage, i) => (
              <li key={stage} className="relative pb-5 pl-7 text-sm text-ivory/75 last:pb-0">
                <span aria-hidden className="absolute top-1.5 left-0 size-2.5 rounded-full bg-gold" />
                {i < STAGES.length - 1 && (
                  <span aria-hidden className="absolute top-5 bottom-1 left-[4px] border-l-2 border-dashed border-gold/50" />
                )}
                {stage}
              </li>
            ))}
          </ol>
        </div>
        <p className="text-sm text-ivory/55">Customers, enquiries, orders and payments in one place.</p>
      </aside>

      <main className="flex flex-col px-5 pt-[calc(env(safe-area-inset-top)+2rem)] pb-[calc(env(safe-area-inset-bottom)+2rem)] sm:px-10">
        <Wordmark className="text-2xl lg:hidden" />
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">{children}</div>
      </main>
    </div>
  );
}

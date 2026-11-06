import Link from "next/link";

/** Under a maker picker: where the list comes from, and a way to add someone missing from it. */
export function MakerHint({ slug, canAdd }: { slug: string; canAdd: boolean }) {
  return canAdd ? (
    <span className="text-sm text-muted">
      Someone missing?{" "}
      <Link href={`/w/${slug}/stock/makers`} className="inline-flex min-h-11 items-center font-medium text-gold-ink underline underline-offset-4">
        Add a maker
      </Link>
    </span>
  ) : (
    <span className="text-sm text-muted">Someone missing? An owner or the production manager adds makers under Stock → Makers.</span>
  );
}

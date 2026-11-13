import { Money } from "@/components/ui/bits";
import { balanceSide } from "@/lib/books";

/** A debit-positive balance shown as "₦45,000 Dr" / "₦45,000 Cr"; blank for nil. */
export function Signed({ minor, currency }: { minor: number; currency: string }) {
  if (!minor) return <span className="text-muted">–</span>;
  return (
    <span className="whitespace-nowrap">
      <Money minor={Math.abs(minor)} currency={currency} /> <span className="text-xs text-muted">{balanceSide(minor)}</span>
    </span>
  );
}

import { cn } from "@/lib/cn";

/** Text wordmark until the official logo is supplied. Never replace with an invented logo. */
export function Wordmark({ className, name = "HaleyH Creations" }: { className?: string; name?: string }) {
  return <span className={cn("font-display font-medium tracking-[-0.01em]", className)}>{name}</span>;
}

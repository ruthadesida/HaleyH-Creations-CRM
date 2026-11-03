import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Buttons answer on press (scale 0.97, ease-out) and only hover on devices that can.
 * Large by default: staff tap these all day on phones.
 */
export const buttonStyles = cva(
  [
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius-card)] font-medium",
    "transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)]",
    "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:size-[1.15em] [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-ink text-ivory hover:bg-[#3a3732]",
        gold: "bg-gold text-ink hover:bg-[#a07f4c]",
        secondary: "border border-line-strong bg-surface text-ink hover:border-ink/40",
        ghost: "text-ink hover:bg-ink/5",
        danger: "border border-danger/30 bg-surface text-danger hover:bg-danger-soft",
      },
      size: {
        sm: "h-11 px-3.5 text-sm",
        md: "h-12 px-4 text-base",
        lg: "h-14 px-5 text-base",
        icon: "size-11",
      },
      block: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type StyleProps = VariantProps<typeof buttonStyles>;

export function Button({ className, variant, size, block, type = "button", ...props }: ComponentProps<"button"> & StyleProps) {
  return <button type={type} className={cn(buttonStyles({ variant, size, block }), className)} {...props} />;
}

export function ButtonLink({ className, variant, size, block, ...props }: ComponentProps<typeof Link> & StyleProps) {
  return <Link className={cn(buttonStyles({ variant, size, block }), className)} {...props} />;
}

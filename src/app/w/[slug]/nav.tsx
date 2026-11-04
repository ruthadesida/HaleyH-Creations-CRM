"use client";

import {
  Boxes,
  ClipboardCheck,
  FileUp,
  History,
  MapPin,
  Scissors,
  Truck,
  ClipboardList,
  Inbox,
  type LucideIcon,
  Menu,
  Package,
  Plus,
  Settings,
  Sun,
  Users,
  Wallet,
  UserPlus,
  MessageSquarePlus,
  ShoppingBag,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Drawer } from "vaul";
import { cn } from "@/lib/cn";
import type { Role } from "@/lib/dal";
import { FEATURES } from "@/lib/features";

type Item = { href: string; label: string; icon: LucideIcon; exact?: boolean };

function items(slug: string, role: Role) {
  const base = `/w/${slug}`;
  const stock = `${base}/stock`;
  if (role === "production_manager") {
    const tabs: (Item | false)[] = [
      FEATURES.inventory && { href: stock, label: "Stock", icon: Boxes, exact: true },
      FEATURES.inventory && { href: `${stock}/counts`, label: "Counts", icon: ClipboardCheck },
      FEATURES.inventory && { href: `${stock}/makers`, label: "Makers", icon: Scissors },
    ];
    const extra: (Item | false)[] = [
      FEATURES.inventory && { href: `${stock}/movements`, label: "Movements", icon: History },
      FEATURES.inventory && { href: `${stock}/opening`, label: "Opening stock", icon: FileUp },
      FEATURES.inventory && { href: `${stock}/products`, label: "Products", icon: Package },
      FEATURES.inventory && { href: `${stock}/suppliers`, label: "Suppliers", icon: Truck },
      FEATURES.inventory && { href: `${stock}/locations`, label: "Locations", icon: MapPin },
    ];
    return { tabs: tabs.filter(Boolean) as Item[], extra: extra.filter(Boolean) as Item[] };
  }
  const tabs: (Item | false)[] = [
    { href: base, label: "Today", icon: Sun, exact: true },
    { href: `${base}/enquiries`, label: "Enquiries", icon: Inbox },
    FEATURES.orders && { href: `${base}/orders`, label: "Orders", icon: ShoppingBag },
    { href: `${base}/customers`, label: "Customers", icon: Users },
    FEATURES.inventory && { href: stock, label: "Stock", icon: Boxes },
  ];
  const extra: (Item | false)[] = [
    FEATURES.tasks && { href: `${base}/tasks`, label: "Follow-ups", icon: ClipboardList },
    FEATURES.settings && role === "owner" && { href: `${base}/settings`, label: "Settings", icon: Settings },
  ];
  return { tabs: tabs.filter(Boolean) as Item[], extra: extra.filter(Boolean) as Item[] };
}

function useActive() {
  const path = usePathname();
  return (item: Item) => (item.exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`));
}

export function Sidebar({ slug, role, name }: { slug: string; role: Role; name: string }) {
  const { tabs, extra } = items(slug, role);
  const isActive = useActive();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {[...tabs, ...extra].map((item) => {
        const active = isActive(item);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-11 items-center gap-3 rounded-[var(--radius-card)] px-3 text-[15px] transition-colors duration-150",
              active ? "bg-ink text-ivory" : "text-ink hover:bg-ink/5",
            )}>
            <item.icon aria-hidden className={cn("size-[18px]", active ? "text-gold" : "text-muted")} />
            {item.label}
          </Link>
        );
      })}
      <span className="sr-only">Workspace: {name}</span>
    </nav>
  );
}

export function BottomTabs({ slug, role }: { slug: string; role: Role }) {
  const { tabs, extra } = items(slug, role);
  const isActive = useActive();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = extra.some(isActive);

  return (
    <nav aria-label="Main"
      className="material fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ivory pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto flex max-w-xl">
        {tabs.map((item) => {
          const active = isActive(item);
          return (
            <li key={item.href} className="flex-1">
              <Link href={item.href} aria-current={active ? "page" : undefined}
                className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium active:scale-95 transition-transform duration-100">
                <item.icon aria-hidden className={cn("size-[22px]", active ? "text-ink" : "text-muted")} strokeWidth={active ? 2.25 : 1.75} />
                <span className={active ? "text-ink" : "text-muted"}>{item.label}</span>
              </Link>
            </li>
          );
        })}
        {extra.length > 0 && (
          <li className="flex-1">
            <Drawer.Root open={moreOpen} onOpenChange={setMoreOpen}>
              <Drawer.Trigger
                className="flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium active:scale-95 transition-transform duration-100">
                <Menu aria-hidden className={cn("size-[22px]", moreActive ? "text-ink" : "text-muted")} />
                <span className={moreActive ? "text-ink" : "text-muted"}>More</span>
              </Drawer.Trigger>
              <Sheet title="More">
                <ul className="flex flex-col">
                  {extra.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} onClick={() => setMoreOpen(false)}
                        className="flex h-14 items-center gap-4 border-b border-line text-lg last:border-b-0 active:bg-ink/5">
                        <item.icon aria-hidden className="size-5 text-gold-ink" />
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Sheet>
            </Drawer.Root>
          </li>
        )}
      </ul>
    </nav>
  );
}

/** Bottom sheet built on Vaul: drag-to-dismiss with momentum, safe-area padding. */
export function Sheet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Drawer.Portal>
      <Drawer.Overlay className="fixed inset-0 z-40 bg-ink/40" />
      <Drawer.Content
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] max-w-xl flex-col rounded-t-2xl bg-surface outline-none">
        <div aria-hidden className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-ink/15" />
        <Drawer.Title className="px-5 pt-4 pb-2 text-lg font-semibold">{title}</Drawer.Title>
        <Drawer.Description className="sr-only">{title}</Drawer.Description>
        <div className="overflow-y-auto overscroll-contain px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">{children}</div>
      </Drawer.Content>
    </Drawer.Portal>
  );
}

const NEW_ACTIONS = (slug: string) =>
  [
    { href: `/w/${slug}/enquiries/new`, label: "New enquiry", hint: "Someone asked about an item", icon: MessageSquarePlus },
    FEATURES.orders && { href: `/w/${slug}/orders/new`, label: "New order", hint: "Items, delivery and price", icon: ShoppingBag },
    { href: `/w/${slug}/customers/new`, label: "New customer", hint: "Contact details and sizes", icon: UserPlus },
    FEATURES.payments && { href: `/w/${slug}/orders?pay=1`, label: "Record a payment", hint: "Find the order, then record it", icon: Wallet },
  ].filter(Boolean) as { href: string; label: string; hint: string; icon: LucideIcon }[];

/** One-thumb "New" button on phones; a full-width button in the sidebar on laptops. */
export function NewButton({ slug, variant }: { slug: string; variant: "fab" | "sidebar" }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // On form screens the floating button would sit on top of fields; the person is already creating something.
  if (variant === "fab" && /\/(new|edit|transfer|counts|settings)(\/|$)/.test(pathname)) return null;
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger
        className={cn(
          "flex items-center justify-center gap-2 font-medium transition-transform duration-150 ease-[var(--ease-out)] active:scale-95",
          variant === "fab"
            ? "fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-30 size-14 rounded-full bg-gold text-ink shadow-[0_8px_24px_-6px_rgba(35,33,30,0.45)] lg:hidden"
            : "h-12 w-full rounded-[var(--radius-card)] bg-gold text-ink hover:bg-[#a07f4c]",
        )}
        aria-label="New">
        <Plus aria-hidden className="size-6" strokeWidth={2.25} />
        {variant === "sidebar" && "New"}
      </Drawer.Trigger>
      <Sheet title="Create">
        <ul className="flex flex-col gap-2">
          {NEW_ACTIONS(slug).map((a) => (
            <li key={a.href}>
              <Link href={a.href} onClick={() => setOpen(false)}
                className="flex min-h-16 items-center gap-4 rounded-[var(--radius-card)] border border-line px-4 py-3 active:scale-[0.99] active:bg-ink/5 transition-transform duration-100">
                <span className="flex size-10 items-center justify-center rounded-full bg-gold-soft text-gold-ink">
                  <a.icon aria-hidden className="size-5" />
                </span>
                <span>
                  <span className="block font-medium">{a.label}</span>
                  <span className="text-sm text-muted">{a.hint}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
    </Drawer.Root>
  );
}

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

/** Shows a success toast after a redirect like `?saved=1`, then tidies the URL. */
export function ToastOnParam({ messages }: { messages: Record<string, string> }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const key = Object.keys(messages).find((k) => params.get(k) === "1");
    if (!key) return;
    toast.success(messages[key], { id: `${pathname}-${key}` });
    const sp = new URLSearchParams(params);
    sp.delete(key);
    const s = sp.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [params, messages, pathname, router]);

  return null;
}

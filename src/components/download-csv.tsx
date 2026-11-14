"use client";

import { Download } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Downloads a file (CSV by default) from inside the page. A plain link can be handed to the phone's downloader or
 * another browser that isn't signed in, which lands on the sign-in page (and in some in-app browsers
 * swallows the refreshed session, signing the person out). Fetching here keeps the session in this tab.
 */
export function DownloadCsv({ href, fallbackName }: { href: string; fallbackName: string }) {
  return <DownloadFile href={href} fallbackName={fallbackName} />;
}

/** Same, for any file type: `type` is part of the expected Content-Type (e.g. "spreadsheetml" for .xlsx). */
export function DownloadFile({ href, fallbackName, label = "Download CSV", type: expected = "text/csv" }: {
  href: string; fallbackName: string; label?: string; type?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" disabled={pending} onClick={() => start(async () => {
      try {
        const res = await fetch(href, { credentials: "same-origin", cache: "no-store" });
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || !type.includes(expected)) {
          toast.error(res.status === 403 ? "You don't have access to this." : "Couldn't download it. Refresh the page and try again.");
          return;
        }
        const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } catch {
        toast.error("Couldn't download it. Check the connection and try again.");
      }
    })}>
      <Download aria-hidden /> {pending ? "Preparing…" : label}
    </Button>
  );
}

"use client";

import { Download } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Downloads a CSV from inside the page. A plain link can be handed to the phone's downloader or
 * another browser that isn't signed in, which lands on the sign-in page (and in some in-app browsers
 * swallows the refreshed session, signing the person out). Fetching here keeps the session in this tab.
 */
export function DownloadCsv({ href, fallbackName }: { href: string; fallbackName: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" disabled={pending} onClick={() => start(async () => {
      try {
        const res = await fetch(href, { credentials: "same-origin", cache: "no-store" });
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || !type.includes("text/csv")) {
          toast.error(res.status === 403 ? "You don't have access to this report." : "Couldn't download the report. Refresh the page and try again.");
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
        toast.error("Couldn't download the report. Check the connection and try again.");
      }
    })}>
      <Download aria-hidden /> {pending ? "Preparing…" : "Download CSV"}
    </Button>
  );
}

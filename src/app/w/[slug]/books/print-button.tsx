"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog (print styles hide the app's menus). */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return <Button variant="secondary" onClick={() => window.print()}><Printer aria-hidden /> {label}</Button>;
}

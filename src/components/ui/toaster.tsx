"use client";

import { Toaster as Sonner } from "sonner";

/** Mounted once in the root layout. Top-centre so it never collides with the phone tab bar. */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      richColors
      closeButton
      mobileOffset={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      toastOptions={{
        style: {
          fontFamily: "var(--font-sans)",
          fontSize: "15px",
          borderRadius: "var(--radius-card)",
          border: "1px solid var(--color-line)",
        },
      }}
    />
  );
}

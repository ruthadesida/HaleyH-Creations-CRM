"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useEffect, useRef, useSyncExternalStore } from "react";

const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

// The full-width widget needs 300px; the auth pages have 20px gutters, so phones narrower than 360px get the compact one.
const WIDE = "(min-width: 360px)";
const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/**
 * Cloudflare Turnstile check, placed inside a form: it adds its token to the form as "cf-turnstile-response".
 * Renders nothing without a site key (development and tests). A token works once, so pass the form's action
 * state as `resetKey` and a fresh check starts after every submission.
 */
export function Captcha({ resetKey }: { resetKey: unknown }) {
  const ref = useRef<TurnstileInstance>(null);
  const first = useRef(true);
  // null on the server and during hydration: the size is only known in the browser, and a widget rendered at the
  // wrong size would remount and waste its check.
  const wide = useSyncExternalStore<boolean | null>(subscribe, () => window.matchMedia(WIDE).matches, () => null);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.reset();
  }, [resetKey]);

  if (!siteKey) return null;
  if (wide === null) return <div aria-hidden className="min-h-[65px]" />;
  return (
    <Turnstile
      key={wide ? "wide" : "compact"}
      ref={ref}
      siteKey={siteKey}
      options={{ theme: "light", size: wide ? "flexible" : "compact", language: "auto" }}
      className={wide ? "min-h-[65px] w-full" : "min-h-[140px]"}
    />
  );
}

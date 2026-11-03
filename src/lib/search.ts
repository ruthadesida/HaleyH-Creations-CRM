/**
 * Makes free-text search safe to embed in a PostgREST `or=(...)` filter.
 * Commas, parentheses, quotes, backslashes and wildcards would otherwise change
 * the filter's meaning, so they are removed.
 */
export function cleanSearch(raw: unknown, max = 60): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[,()*%\\"':.]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Digits only, for matching phone numbers typed in any format. */
export function searchDigits(q: string): string {
  const d = q.replace(/\D/g, "");
  if (d.startsWith("0") && d.length > 1) return d.slice(1); // 0803… matches +234803…
  return d;
}

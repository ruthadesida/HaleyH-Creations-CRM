/**
 * Supabase's generated types mark every RPC argument as required, even ones the SQL function accepts as
 * null (e.g. "no purchase order" for a quick purchase). This sends a real null for blank optional values.
 */
export function orNull(value: string | null | undefined): string {
  return (value ? value : null) as unknown as string;
}

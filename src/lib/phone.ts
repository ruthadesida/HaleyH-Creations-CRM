/**
 * Phone helpers. `normalizePhone` mirrors the SQL function `app.normalize_phone`,
 * which powers duplicate detection in the database.
 */

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw || raw.trim() === "") return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.startsWith("0") && digits.length === 11) return `+234${digits.slice(1)}`;
  if (digits.startsWith("234")) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Builds a WhatsApp click-to-chat link with a prepared message. It only opens
 * WhatsApp; a staff member reviews and sends the message themselves.
 */
export function whatsappLink(phone: string | null | undefined, message: string): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const number = normalized.slice(1);
  if (number.length < 8 || number.length > 15) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/** "+2348031112222" → "+234 803 111 2222" for display. Other formats are returned as typed. */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const n = normalizePhone(raw);
  if (n && /^\+234\d{10}$/.test(n)) {
    return `+234 ${n.slice(4, 7)} ${n.slice(7, 10)} ${n.slice(10)}`;
  }
  return raw;
}

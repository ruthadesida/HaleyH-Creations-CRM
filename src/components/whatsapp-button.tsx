import { MessageCircle } from "lucide-react";
import { buttonStyles } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { whatsappLink } from "@/lib/phone";

/**
 * Opens WhatsApp with a prepared message for a staff member to review and send.
 * It does not send anything itself and is not an automated integration.
 */
export function WhatsAppButton({
  phone,
  message,
  label = "Open in WhatsApp",
  size = "md",
  className,
}: {
  phone: string | null | undefined;
  message: string;
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const href = whatsappLink(phone, message);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className={cn(buttonStyles({ variant: "secondary", size }), className)}
      title="Opens WhatsApp with a message you can edit before sending">
      <MessageCircle aria-hidden /> {label}
    </a>
  );
}

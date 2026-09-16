import { Mail, MessageCircle } from 'lucide-react';

const WHATSAPP_LINK = 'https://wa.me/256758401626';
const EMAIL_LINK = 'mailto:admin@bulamu.site';

/**
 * Icon-only contact row - no phone number or email address is ever shown as
 * visible text on the page, only these two links.
 */
export function ContactIcons({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <a
        href={WHATSAPP_LINK}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with us on WhatsApp"
        className="flex size-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-colors hover:border-emerald-600 hover:text-emerald-700"
      >
        <MessageCircle className="size-4" aria-hidden="true" />
      </a>
      <a
        href={EMAIL_LINK}
        aria-label="Email us"
        className="flex size-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-colors hover:border-emerald-600 hover:text-emerald-700"
      >
        <Mail className="size-4" aria-hidden="true" />
      </a>
    </div>
  );
}

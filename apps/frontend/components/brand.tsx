import { cn } from '@/lib/utils';

export const TAGLINE = 'Patient care, organised.';

/** The Bulamu mark - the same drawing as the app icon (public/icons/icon.svg). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={cn('size-10 shrink-0', className)} aria-hidden="true" focusable="false">
      <rect width="512" height="512" rx="112" fill="#0f766e" />
      <path d="M256 96c63 0 116 49 116 110 0 84-95 165-116 181-21-16-116-97-116-181 0-61 53-110 116-110Z" fill="#ccfbf1" />
      <path d="M236 164h40v52h52v40h-52v52h-40v-52h-52v-40h52v-52Z" fill="#0f766e" />
      <path d="M132 406h248" stroke="#f8fafc" strokeWidth="32" strokeLinecap="round" />
    </svg>
  );
}

/** The mark with the name and tagline beside it. `tone` is the background it sits on. */
export function BrandLockup({ tone = 'light', size = 'md', className }: { tone?: 'light' | 'dark'; size?: 'md' | 'lg'; className?: string }) {
  return (
    <span className={cn('flex items-center gap-3', className)}>
      <BrandMark className={size === 'lg' ? 'size-11' : 'size-10'} />
      <span className="min-w-0 leading-tight">
        <span className={cn('block font-bold tracking-tight', size === 'lg' ? 'text-2xl' : 'text-lg', tone === 'dark' ? 'text-white' : 'text-slate-950 dark:text-slate-50')}>
          Bulamu
        </span>
        <span className={cn('block text-xs font-medium', tone === 'dark' ? 'text-emerald-300' : 'text-emerald-700 dark:text-emerald-400')}>{TAGLINE}</span>
      </span>
    </span>
  );
}

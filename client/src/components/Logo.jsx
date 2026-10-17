/**
 * Logo -- SyncScribe mark (a frame with two caption lines) plus wordmark.
 * The mark is also the favicon (public/favicon.svg); keep the two in sync.
 */
export function LogoMark({ className = 'h-7 w-7' }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-stone-900 dark:fill-white" />
      <rect x="7" y="17" width="18" height="3" rx="1.5" className="fill-brand-400 dark:fill-brand-500" />
      <rect x="10" y="22.5" width="12" height="3" rx="1.5" className="fill-white/70 dark:fill-stone-900/60" />
    </svg>
  );
}

export default function Logo({ className = '' }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-tight text-stone-900 dark:text-stone-50">
        SyncScribe
      </span>
    </span>
  );
}

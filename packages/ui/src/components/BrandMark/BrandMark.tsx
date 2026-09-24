import { cn } from '@/lib/utils';
import { useUIConfig } from '../../hooks/useUIConfig';

export const DEFAULT_BOARD_TITLE = 'Worker Manager';

export function useBoardBrand() {
  const { boardLogo, boardTitle } = useUIConfig();
  return { logo: boardLogo, title: boardTitle ?? DEFAULT_BOARD_TITLE };
}

/** The board's logo (uiConfig.boardLogo), or the Worker Manager mark when none is configured. */
export const BrandMark = ({ className }: { className?: string }) => {
  const { logo, title } = useBoardBrand();

  if (logo?.path) {
    return (
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg',
          className
        )}
      >
        <img
          src={logo.path}
          width={logo.width}
          height={logo.height}
          alt={title}
          className="max-h-full max-w-full object-contain"
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg',
        'bg-linear-to-br from-primary to-violet-500 shadow-sm ring-1 ring-primary/30 ring-inset',
        'before:absolute before:inset-0 before:bg-linear-to-b before:from-white/25 before:to-transparent',
        className
      )}
    >
      {/* `!`: the sidebar menu button sizes every descendant svg to size-4. */}
      <WorkerManagerGlyph className="relative size-6!" />
    </span>
  );
};

/**
 * The Worker Manager mark without its tile: three jobs moving through a queue, the leading one
 * done. Drawn inline so the default brand needs no static asset and follows the base path.
 */
export const WorkerManagerGlyph = ({ className }: { className?: string }) => (
  <svg viewBox="3 5 33 30" fill="none" className={className}>
    <rect x="4" y="7" width="20" height="6" rx="3" fill="white" fillOpacity={0.55} />
    <rect x="4" y="16" width="28" height="6" rx="3" fill="white" fillOpacity={0.8} />
    <rect x="4" y="25" width="15" height="6" rx="3" fill="white" />
    <circle cx="28.5" cy="28" r="6" fill="#22C55E" stroke="white" strokeWidth={2.5} />
    <path
      d="M25.9 28.1l1.8 1.8 3.6-3.8"
      stroke="white"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

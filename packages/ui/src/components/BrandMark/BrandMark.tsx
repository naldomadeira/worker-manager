import { cn } from '@/lib/utils';
import { useUIConfig } from '../../hooks/useUIConfig';

export const DEFAULT_BOARD_TITLE = 'Worker Manager';

export function useBoardBrand() {
  const { boardLogo, boardTitle } = useUIConfig();
  return { logo: boardLogo, title: boardTitle ?? DEFAULT_BOARD_TITLE };
}

/** The board's logo (uiConfig.boardLogo), or a gradient "WM" monogram when none is configured. */
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
        'bg-linear-to-br from-primary to-violet-500 text-[0.7rem] font-bold tracking-tight text-white',
        'shadow-sm ring-1 ring-primary/30 ring-inset',
        'before:absolute before:inset-0 before:bg-linear-to-b before:from-white/25 before:to-transparent',
        className
      )}
    >
      <span className="relative">WM</span>
    </span>
  );
};

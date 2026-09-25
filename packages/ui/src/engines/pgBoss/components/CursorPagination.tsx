import { ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CursorPaginationProps {
  /** The page being shown has a cursor of its own, so a first page exists before it. */
  isFirstPage: boolean;
  prevCursor: string | null;
  nextCursor: string | null;
  /** Moves to the page behind this cursor, or back to the first page with `undefined`. */
  onNavigate(cursor: string | undefined): void;
  className?: string;
}

/**
 * Keyset pagination: previous and next, plus a way back to the start. There are no page
 * numbers, because a keyset has no offsets to count.
 */
export const CursorPagination = ({
  isFirstPage,
  prevCursor,
  nextCursor,
  onNavigate,
  className,
}: CursorPaginationProps) => {
  const { t } = useTranslation();

  if (isFirstPage && !nextCursor) {
    return null;
  }

  return (
    <nav
      aria-label={t('PGBOSS.PAGINATION.LABEL')}
      className={cn('flex items-center gap-0.5', className)}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={isFirstPage}
        onClick={() => onNavigate(undefined)}
        aria-label={t('PGBOSS.PAGINATION.FIRST')}
        title={t('PGBOSS.PAGINATION.FIRST')}
        className="text-muted-foreground hover:text-foreground"
      >
        <ChevronsLeftIcon />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={isFirstPage || !prevCursor}
        onClick={() => onNavigate(prevCursor ?? undefined)}
        className="text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon data-icon="inline-start" />
        {t('PGBOSS.PAGINATION.PREVIOUS')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={!nextCursor}
        onClick={() => onNavigate(nextCursor ?? undefined)}
        className="text-muted-foreground hover:text-foreground"
      >
        {t('PGBOSS.PAGINATION.NEXT')}
        <ChevronRightIcon data-icon="inline-end" />
      </Button>
    </nav>
  );
};

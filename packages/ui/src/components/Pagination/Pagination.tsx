import { ChevronLeft, ChevronRight, Ellipsis } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useHistory, useLocation } from 'react-router-dom';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface IPaginationProps {
  pageCount: number;
}

const MARGIN_PAGES = 2;
const RANGE_PAGES = 3;

type PageEntry = number | 'break-start' | 'break-end';

/** Page numbers to show: both ends plus a window around the current page, gaps as breaks. */
export function pageEntries(current: number, pageCount: number): PageEntry[] {
  const pages = new Set<number>();
  for (let page = 1; page <= Math.min(MARGIN_PAGES, pageCount); page++) pages.add(page);
  for (let page = Math.max(1, pageCount - MARGIN_PAGES + 1); page <= pageCount; page++) {
    pages.add(page);
  }

  let start = Math.max(1, current - Math.floor(RANGE_PAGES / 2));
  const end = Math.min(pageCount, start + RANGE_PAGES - 1);
  start = Math.max(1, end - RANGE_PAGES + 1);
  for (let page = start; page <= end; page++) pages.add(page);

  const sorted = [...pages].sort((a, b) => a - b);
  const entries: PageEntry[] = [];
  sorted.forEach((page, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined && page - previous > 1) {
      // A single missing page reads better as its number than as an ellipsis.
      if (page - previous === 2) entries.push(previous + 1);
      else entries.push(page < current ? 'break-start' : 'break-end');
    }
    entries.push(page);
  });
  return entries;
}

const itemClass = cn(
  buttonVariants({ variant: 'ghost', size: 'icon' }),
  'relative min-w-8 px-2 tabular-nums text-muted-foreground hover:bg-state-hover hover:text-foreground'
);

export const Pagination = ({ pageCount }: IPaginationProps) => {
  const { t } = useTranslation();
  const location = useLocation();
  const history = useHistory();
  const reduceMotion = useReducedMotion();

  if (pageCount <= 1) {
    return null;
  }

  const query = new URLSearchParams(location.search);
  const current = Math.min(Math.max(Number(query.get('page')) || 1, 1), pageCount);

  const searchFor = (page: number) => {
    const next = new URLSearchParams(location.search);
    if (page > 1) {
      next.set('page', `${page}`);
    } else {
      next.delete('page');
    }
    next.sort();
    return next.toString();
  };

  const go = (page: number) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    if (page === current || page < 1 || page > pageCount) {
      return;
    }
    history.push({ pathname: location.pathname, search: searchFor(page) });
  };

  const edgeLink = (page: number, label: string, icon: React.ReactNode) => {
    const disabled = page < 1 || page > pageCount;
    return (
      <li>
        <a
          href={disabled ? undefined : `?${searchFor(page)}`}
          aria-label={label}
          aria-disabled={disabled || undefined}
          onClick={disabled ? undefined : go(page)}
          className={cn(itemClass, disabled && 'pointer-events-none opacity-40')}
        >
          {icon}
        </a>
      </li>
    );
  };

  return (
    <nav aria-label={t('PAGINATION.LABEL')} className="flex justify-center">
      <ul className="flex list-none items-center gap-0.5 rounded-xl border bg-card p-1 shadow-xs">
        {edgeLink(current - 1, t('PAGINATION.PREVIOUS'), <ChevronLeft />)}
        {pageEntries(current, pageCount).map((entry) =>
          typeof entry === 'number' ? (
            <li key={entry}>
              <a
                href={`?${searchFor(entry)}`}
                aria-label={t('PAGINATION.PAGE', { page: entry })}
                aria-current={entry === current ? 'page' : undefined}
                onClick={go(entry)}
                className={cn(
                  itemClass,
                  entry === current &&
                    'text-primary-foreground hover:bg-transparent hover:text-primary-foreground'
                )}
              >
                {entry === current && (
                  <motion.span
                    layoutId="pagination-active"
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 500, damping: 38 }
                    }
                    className="absolute inset-0 rounded-lg bg-primary shadow-xs"
                  />
                )}
                <span className="relative">{entry}</span>
              </a>
            </li>
          ) : (
            <li
              key={entry}
              aria-hidden="true"
              className="flex size-8 items-center justify-center text-muted-foreground"
            >
              <Ellipsis className="size-4" />
            </li>
          )
        )}
        {edgeLink(current + 1, t('PAGINATION.NEXT'), <ChevronRight />)}
      </ul>
    </nav>
  );
};

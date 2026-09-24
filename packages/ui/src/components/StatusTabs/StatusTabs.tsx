import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { CSSProperties, PropsWithChildren, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { matchPath, NavLink, NavLinkProps, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useOverflowFade } from '../../hooks/useOverflowFade';
import { dynamicTranslationKey } from '../../utils/dynamicTranslationKey';
import { statusTone } from '../StatusTone/statusTone';

export interface StatusTabItem {
  status: string;
  to: NavLinkProps['to'];
  isActive: NavLinkProps['isActive'];
  count?: number;
  dot?: boolean;
}

interface StatusTabsProps {
  items: StatusTabItem[];
}

/** Length of the overflow fade at whichever edge still has tabs beyond it. */
const FADE_WIDTH = '2rem';

function pathOf(to: NavLinkProps['to']): string {
  if (typeof to === 'string') {
    return to.split('?')[0];
  }
  if (to && typeof to === 'object' && 'pathname' in to) {
    return to.pathname ?? '';
  }
  return '';
}

export const StatusTabs = ({ items, children }: PropsWithChildren<StatusTabsProps>) => {
  const { t } = useTranslation();
  const location = useLocation();
  const groupId = useId();
  const reduceMotion = useReducedMotion();
  const [tabsRef, overflow] = useOverflowFade<HTMLUListElement>();

  return (
    <div
      data-slot="status-bar"
      className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 flex-1">
        <LayoutGroup id={groupId}>
          <ul
            ref={tabsRef}
            className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border bg-muted/60 p-1 [scrollbar-width:none] [mask-image:linear-gradient(to_right,transparent,black_var(--fade-start),black_calc(100%-var(--fade-end)),transparent)] [&::-webkit-scrollbar]:hidden"
            style={
              {
                '--fade-start': overflow.start ? FADE_WIDTH : '0px',
                '--fade-end': overflow.end ? FADE_WIDTH : '0px',
              } as CSSProperties
            }
          >
            {items.map(({ status, to, isActive, count, dot = true }) => {
              const displayStatus = t(
                dynamicTranslationKey(`QUEUE.STATUS.${status.toUpperCase()}`)
              );
              const match = matchPath(location.pathname, { path: pathOf(to), exact: true });
              const active = isActive ? !!isActive(match as any, location) : !!match;
              const tone = statusTone(status);

              return (
                <li key={status} className="relative flex shrink-0">
                  <NavLink
                    to={to}
                    isActive={isActive}
                    activeClassName="isActive"
                    className={cn(
                      'relative inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[0.8125rem] font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                      active && 'text-foreground'
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="status-tab-indicator"
                        aria-hidden
                        className="absolute inset-0 rounded-lg bg-background shadow-sm ring-1 ring-foreground/10 dark:bg-card"
                        transition={
                          reduceMotion
                            ? { duration: 0 }
                            : { type: 'spring', stiffness: 500, damping: 38, mass: 0.8 }
                        }
                      />
                    )}
                    {dot && (
                      <span
                        aria-hidden
                        className={cn(
                          'dot relative size-2 shrink-0 rounded-full',
                          tone.dot,
                          status === 'active' && count
                            ? 'animate-pulse-ring text-status-active'
                            : ''
                        )}
                      />
                    )}
                    <span className="relative">{displayStatus}</span>
                    <AnimatePresence initial={false} mode="popLayout">
                      {count != null && count > 0 && (
                        <motion.span
                          key={count}
                          initial={reduceMotion ? false : { opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={reduceMotion ? undefined : { opacity: 0, y: 6 }}
                          transition={{ duration: 0.18 }}
                          className={cn(
                            'badge relative inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-mono text-[0.6875rem] leading-none font-normal tabular-nums',
                            active
                              ? cn(tone.soft, 'text-foreground')
                              : 'bg-foreground/5 text-muted-foreground'
                          )}
                        >
                          {count}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </LayoutGroup>
      </div>
      {!!children && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
          {children}
        </div>
      )}
    </div>
  );
};

import type { AppQueue } from '@worker-manager/api/typings/app';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { QueueCard } from './QueueCard';

export interface QueueCardGridItem {
  key: string;
  queue: AppQueue;
  displayName?: string;
}

interface QueueCardGridProps {
  items: QueueCardGridItem[];
  className?: string;
}

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * Responsive grid of queue cards. Cards fade up in a short stagger when they first appear and
 * glide to their new slot when sorting or filtering reorders them. Only the position is
 * animated (`layout="position"`), so a card whose content grows between polls never squashes.
 */
export const QueueCardGrid = ({ items, className }: QueueCardGridProps) => {
  const reduceMotion = useReducedMotion();

  return (
    <ul
      className={cn(
        'relative m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-[repeat(auto-fill,minmax(19rem,1fr))]',
        className
      )}
    >
      <AnimatePresence initial mode="popLayout">
        {items.map((item, index) => (
          <motion.li
            key={item.key}
            layout={reduceMotion ? false : 'position'}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 14 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: {
                duration: 0.4,
                ease: EASE_OUT,
                delay: reduceMotion ? 0 : Math.min(index, 14) * 0.035,
              },
            }}
            exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.97, transition: { duration: 0.15 } }}
            transition={{ layout: { duration: 0.35, ease: EASE_OUT } }}
            className="min-w-0"
          >
            <QueueCard queue={item.queue} displayName={item.displayName} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
};

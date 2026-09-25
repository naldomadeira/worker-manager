import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type ReactNode, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { useConfirm } from '../../hooks/useConfirm';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import { Loader } from '../Loader/Loader';
import { AppShell } from './AppShell';

type Location = ReturnType<typeof useLocation>;

interface BoardFrameProps {
  /** The engine's route table, matched against the location the page transition is keyed on. */
  renderRoutes(location: Location): ReactNode;
}

/**
 * The shell with its page transition and the shared confirm dialog around an engine's pages.
 * Every engine renders through this, so they all look and move the same.
 */
export const BoardFrame = ({ renderRoutes }: BoardFrameProps) => {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const { confirmProps } = useConfirm();

  return (
    <AppShell>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          <Suspense fallback={<Loader />}>{renderRoutes(location)}</Suspense>
        </motion.div>
      </AnimatePresence>
      <ConfirmModal {...confirmProps} />
    </AppShell>
  );
};

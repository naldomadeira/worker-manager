'use client';

import { GitBranch, Maximize2, Minimize2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import React, { Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useActiveJobId } from '../../hooks/useActiveJobId';
import { useActiveQueueName } from '../../hooks/useActiveQueueName';
import { useJobFlow } from '../../hooks/useJobFlow';
import { HintTooltip } from '../HintTooltip/HintTooltip';

const FlowGraphLazy = React.lazy(() => import('./FlowGraph'));

export const JobFlow = () => {
  const { t } = useTranslation();
  const { flow, loading, error } = useJobFlow();
  const jobId = useActiveJobId();
  const queueName = useActiveQueueName();
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFullscreen(false);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <Spinner className="size-6 text-status-active" aria-label={t('LOADING')} />
        <p>{t('JOB.FLOW.LOADING')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className="animate-fade-in-up">
        <AlertTitle>{t('JOB.FLOW.ERROR_TITLE')}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!flow || !flow.isFlowNode || !flow.flowRoot) {
    return null;
  }

  const toggleLabel = t(fullscreen ? 'JOB.FLOW.FULLSCREEN_EXIT' : 'JOB.FLOW.FULLSCREEN_ENTER');

  return (
    <>
      <AnimatePresence>
        {fullscreen && (
          <motion.div
            key="flow-backdrop"
            aria-hidden
            className="fixed inset-0 z-40 bg-overlay backdrop-blur-xs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setFullscreen(false)}
          />
        )}
      </AnimatePresence>
      <Card
        className={cn(
          'animate-fade-in-up gap-0 py-0 shadow-xs',
          fullscreen && 'fixed inset-3 z-50 rounded-2xl shadow-popover sm:inset-6'
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b py-2.5 pr-2.5 pl-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <GitBranch className="size-3.5" />
            </span>
            <h4 className="m-0 text-sm font-semibold">{t('JOB.FLOW.TITLE')}</h4>
          </div>
          <HintTooltip title={toggleLabel}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={toggleLabel}
              onClick={() => setFullscreen((current) => !current)}
            >
              {fullscreen ? <Minimize2 /> : <Maximize2 />}
            </Button>
          </HintTooltip>
        </div>
        <div
          className={cn(
            'min-h-0 flex-1 overflow-hidden p-3',
            fullscreen ? 'h-[calc(100%-3.25rem)]' : 'h-auto min-[1100px]:h-[480px]'
          )}
        >
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Spinner className="size-6 text-status-active" aria-label={t('LOADING')} />
              </div>
            }
          >
            <FlowGraphLazy
              root={flow.flowRoot}
              activeJob={jobId ? { id: jobId, queueName } : null}
            />
          </Suspense>
        </div>
      </Card>
    </>
  );
};

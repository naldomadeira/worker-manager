import { Activity, Timer } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { MetricsChartTab } from '../../hooks/useSettings';
import { useSettingsStore } from '../../hooks/useSettings';
import { SEGMENT_THUMB_SPRING } from '../RangeSelector/RangeSelector';

const TABS: MetricsChartTab[] = ['throughput', 'latency'];

const TAB_LABEL_KEYS: Record<MetricsChartTab, 'METRICS.TAB_THROUGHPUT' | 'METRICS.TAB_LATENCY'> = {
  throughput: 'METRICS.TAB_THROUGHPUT',
  latency: 'METRICS.TAB_LATENCY',
};

const TAB_ICONS: Record<MetricsChartTab, typeof Activity> = {
  throughput: Activity,
  latency: Timer,
};

export interface MetricsChartTabSelectorProps {
  className?: string;
}

/**
 * Tab control that switches between the throughput and job-latency charts. Lives in the card
 * header next to the range selector, on both the queue detail page and the metrics history
 * page, so the two cannot drift apart. `MetricsChartPane` below renders whichever chart is
 * currently active; both read the same `metricsChartTab` setting, so the header control and the
 * body content stay in sync without prop drilling between them.
 */
export const MetricsChartTabSelector = ({ className }: MetricsChartTabSelectorProps) => {
  const { t } = useTranslation();
  const thumbId = useId();
  const reduceMotion = useReducedMotion();
  const activeTab = useSettingsStore((state) => state.metricsChartTab);
  const setSettings = useSettingsStore((state) => state.setSettings);

  return (
    <Tabs
      value={activeTab}
      onValueChange={(tab) => setSettings({ metricsChartTab: tab as MetricsChartTab })}
      className={cn('gap-0', className)}
    >
      <TabsList className="h-7! rounded-lg bg-muted p-0.5 ring-1 ring-border/40 ring-inset">
        {TABS.map((tab) => {
          const Icon = TAB_ICONS[tab];
          const active = tab === activeTab;
          return (
            <TabsTrigger
              key={tab}
              value={tab}
              className={cn(
                'relative h-6 flex-none px-2.5 text-xs text-muted-foreground',
                'data-active:bg-transparent data-active:text-foreground data-active:shadow-none dark:data-active:border-transparent dark:data-active:bg-transparent'
              )}
            >
              {active && (
                <motion.span
                  layoutId={`chart-tab-thumb-${thumbId}`}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-md bg-background shadow-xs ring-1 ring-border/70 dark:bg-input/50"
                  transition={reduceMotion ? { duration: 0 } : SEGMENT_THUMB_SPRING}
                />
              )}
              <span className="relative z-10 inline-flex items-center gap-1.5">
                <Icon className="size-3.5" aria-hidden="true" />
                {t(TAB_LABEL_KEYS[tab])}
              </span>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
};

export interface MetricsChartPaneProps {
  throughput?: ReactNode;
  latency?: ReactNode;
}

/**
 * Renders whichever of the throughput/latency charts is currently active. The two charts never
 * share a Y axis -- throughput is counts ("104k"), latency is durations ("15m", "30s") -- so
 * side by side their differently-wide axis labels push the plot areas to different x offsets
 * and the shared date ticks never line up. Showing one chart at a time sidesteps that instead
 * of trying to force the axes to match.
 *
 * Falls back to whichever single chart is present when only one is (e.g. no latency provider
 * configured), and renders nothing when neither is.
 */
export const MetricsChartPane = ({ throughput, latency }: MetricsChartPaneProps) => {
  const activeTab = useSettingsStore((state) => state.metricsChartTab);
  const reduceMotion = useReducedMotion();

  if (!throughput && !latency) {
    return null;
  }

  const showing = !throughput || !latency ? 'single' : activeTab;
  const content =
    !throughput || !latency
      ? (throughput ?? latency)
      : activeTab === 'latency'
        ? latency
        : throughput;

  return (
    <motion.div
      key={showing}
      className="min-w-0"
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      {content}
    </motion.div>
  );
};

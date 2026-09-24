import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '../../../hooks/useSettings';
import { MetricsChartTabSelector } from '../../MetricsChartTabs/MetricsChartTabs';
import { RangeSelector } from '../../RangeSelector/RangeSelector';
import type { Range } from '../QueueMetrics';

const RANGES: Range[] = ['60m', '7d', '30d', '90d'];

const RANGE_LABEL_KEYS: Record<
  Range,
  'METRICS.RANGE_60M' | 'METRICS.RANGE_7D' | 'METRICS.RANGE_30D' | 'METRICS.RANGE_90D'
> = {
  '60m': 'METRICS.RANGE_60M',
  '7d': 'METRICS.RANGE_7D',
  '30d': 'METRICS.RANGE_30D',
  '90d': 'METRICS.RANGE_90D',
};

interface MetricsHeaderProps {
  collapsed: boolean;
  onToggle: () => void;
  showRangeSelector: boolean;
  range: Range;
  onRangeChange: (range: Range) => void;
  /** Whether the throughput/latency tab control has anything to switch between -- a history
   *  provider with latency configured. True regardless of range, including 60m: the control
   *  must stay visible and stable across every range rather than disappearing on 60m, where
   *  native metrics have no latency chart. NativeMetricsView renders an explanation instead of
   *  an empty chart when latency is selected in that mode. */
  showChartTabs: boolean;
}

export const MetricsHeader = ({
  collapsed,
  onToggle,
  showRangeSelector,
  range,
  onRangeChange,
  showChartTabs,
}: MetricsHeaderProps) => {
  const { t } = useTranslation();
  const activeTab = useSettingsStore((state) => state.metricsChartTab);
  const isLatencyView = showChartTabs && activeTab === 'latency';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button
        type="button"
        className="group/toggle -m-1 inline-flex items-center gap-2.5 rounded-lg p-1 text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-expanded={!collapsed}
        onClick={onToggle}
        title={collapsed ? t('METRICS.SHOW') : t('METRICS.HIDE')}
      >
        <span className="inline-flex size-6 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-xs transition-colors group-hover/toggle:bg-state-hover group-hover/toggle:text-foreground">
          <ChevronDown
            aria-hidden="true"
            className={cn('size-3.5 transition-transform duration-200', collapsed && '-rotate-90')}
          />
        </span>
        <h3 className="m-0 text-sm font-semibold whitespace-nowrap">
          {t(isLatencyView ? 'LATENCY.TITLE' : 'METRICS.TITLE')}
        </h3>
      </button>
      {!collapsed &&
        (showChartTabs || showRangeSelector) && (
          // Deliberately wider than the range selector's own internal gap, so the two controls
          // read as separate groups instead of one long segmented control.
          <div className="ml-auto flex flex-wrap items-center gap-2.5 animate-in fade-in-0">
            {showChartTabs && <MetricsChartTabSelector />}
            {showRangeSelector && (
              <RangeSelector
                ranges={RANGES}
                value={range}
                onChange={onRangeChange}
                getLabel={(r) => t(RANGE_LABEL_KEYS[r])}
              />
            )}
          </div>
        )}
    </div>
  );
};

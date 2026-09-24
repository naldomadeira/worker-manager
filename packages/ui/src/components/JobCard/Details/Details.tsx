import type { AppJob, Status } from '@worker-manager/api/typings/app';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { TabsType, useDetailsTabs } from '../../../hooks/useDetailsTabs';
import { dynamicTranslationKey } from '../../../utils/dynamicTranslationKey';
import { DetailsContent } from './DetailsContent/DetailsContent';

interface DetailsProps {
  job: AppJob;
  status: Status;
  actions: { getJobLogs: () => Promise<string[]> };
  withTimeline?: boolean;
  className?: string;
}

export const Details = ({
  status,
  job,
  actions,
  withTimeline = false,
  className,
}: DetailsProps) => {
  const { tabs, selectedTab, selectTab } = useDetailsTabs({ currentStatus: status, withTimeline });
  const { t } = useTranslation();

  if (tabs.length === 0) {
    return null;
  }

  return (
    <Tabs
      className={cn('min-h-0 min-w-0 gap-3', className)}
      value={selectedTab}
      onValueChange={(value) => selectTab(value as TabsType)}
    >
      <div className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <TabsList className="h-8">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              className={cn(
                'px-2.5 text-xs',
                tab === 'Error' && status === 'failed' && 'data-active:text-status-failed'
              )}
            >
              {t(dynamicTranslationKey(`JOB.TABS.${tab.toUpperCase()}`))}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((tab) => (
        <TabsContent
          key={tab}
          value={tab}
          className={cn(
            'relative max-h-80 min-h-0 overflow-auto rounded-lg border bg-muted/40 text-[0.8125rem] animate-in fade-in-0 duration-200',
            '[scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]',
            '[&_pre]:m-0 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-relaxed'
          )}
        >
          <DetailsContent selectedTab={tab} job={job} actions={actions} status={status} />
        </TabsContent>
      ))}
    </Tabs>
  );
};

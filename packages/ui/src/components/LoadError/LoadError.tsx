import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

interface LoadErrorProps {
  /** Already worded for the user, e.g. the translated headline the API sent. */
  error: Error;
  onRetry: () => void;
}

/** What a page shows when the data it is built on could not be fetched at all. */
export const LoadError = ({ error, onRetry }: LoadErrorProps) => {
  const { t } = useTranslation();

  return (
    <Empty role="alert" className="mt-4 border bg-card/50 py-14 animate-fade-in-up">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-10 rounded-xl text-status-failed">
          <TriangleAlert className="size-5" />
        </EmptyMedia>
        <EmptyTitle className="text-base">{t('DASHBOARD.LOAD_ERROR')}</EmptyTitle>
        {error.message && error.message !== t('DASHBOARD.LOAD_ERROR') && (
          <EmptyDescription className="font-mono text-xs">{error.message}</EmptyDescription>
        )}
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('DASHBOARD.RETRY')}
        </Button>
      </EmptyContent>
    </Empty>
  );
};

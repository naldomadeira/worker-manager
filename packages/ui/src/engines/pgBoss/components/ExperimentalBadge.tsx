import { FlaskConicalIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { HintTooltip } from '../../../components/HintTooltip/HintTooltip';

/** Marks the pg-boss engine as experimental, beside the breadcrumb on every pg-boss page. */
export const ExperimentalBadge = () => {
  const { t } = useTranslation();

  return (
    <HintTooltip title={t('PGBOSS.EXPERIMENTAL_HINT')} side="bottom">
      <Badge
        variant="outline"
        tabIndex={0}
        className="shrink-0 gap-1 border-status-delayed/35 bg-status-delayed/10 text-status-delayed max-md:hidden"
      >
        <FlaskConicalIcon aria-hidden="true" />
        {t('PGBOSS.EXPERIMENTAL')}
      </Badge>
    </HintTooltip>
  );
};
